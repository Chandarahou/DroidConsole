import { WebSocketServer, WebSocket } from 'ws';
import { sessionManager } from '../scrcpy/session-manager.js';
import { deviceManager } from '../adb/device-manager.js';
import { batchController } from './batch-controller.js';
import { shareManager } from './share-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WS');

export class WsServer {
  constructor() {
    this.controlWss = null;
    this.videoWss = null;
    this.signalingWss = null;
    this.videoSubscribers = new Map(); // serial -> Set<ws>
    this.controlClients = new Set();
  }

  start(httpServer) {
    // Use noServer mode to handle upgrades manually, bypassing Express middleware
    // which corrupts WebSocket frames (RSV1 bit issue with Express 5).
    const noServerOpts = { noServer: true, perMessageDeflate: false };

    this.controlWss = new WebSocketServer(noServerOpts);
    this.controlWss.on('connection', (ws) => this._handleControlConnection(ws));

    this.videoWss = new WebSocketServer(noServerOpts);
    this.videoWss.on('connection', (ws, req) => this._handleVideoConnection(ws, req));

    this.signalingWss = new WebSocketServer(noServerOpts);
    this.signalingWss.on('connection', (ws, req) => this._handleSignalingConnection(ws, req));

    // Manually handle HTTP upgrade, routing by pathname
    httpServer.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url, 'http://localhost');

      if (pathname === '/ws/control') {
        this.controlWss.handleUpgrade(req, socket, head, (ws) => {
          this.controlWss.emit('connection', ws, req);
        });
      } else if (pathname.startsWith('/ws/video')) {
        this.videoWss.handleUpgrade(req, socket, head, (ws) => {
          this.videoWss.emit('connection', ws, req);
        });
      } else if (pathname.startsWith('/ws/signaling')) {
        this.signalingWss.handleUpgrade(req, socket, head, (ws) => {
          this.signalingWss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    // Cache the latest config and keyframe per device for late-joining subscribers
    this.videoCache = new Map(); // serial -> { config: Buffer, keyframe: Buffer }

    // Forward video data from scrcpy sessions to subscribers
    sessionManager.on('videoData', (serial, data) => {
      // Cache config and keyframe packets
      if (data.length > 0) {
        const flags = data[0];
        if (flags & 0x01) {
          // Config (SPS/PPS)
          if (!this.videoCache.has(serial)) this.videoCache.set(serial, {});
          this.videoCache.get(serial).config = Buffer.from(data);
        } else if (flags & 0x02) {
          // Keyframe (IDR)
          if (!this.videoCache.has(serial)) this.videoCache.set(serial, {});
          this.videoCache.get(serial).keyframe = Buffer.from(data);
        }
      }

      const subs = this.videoSubscribers.get(serial);
      if (!subs || subs.size === 0) return;
      for (const ws of subs) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      }
    });

    // Forward device events to control clients
    const forwardEvent = (event, data) => {
      const msg = JSON.stringify({ type: event, data });
      for (const ws of this.controlClients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      }
    };

    deviceManager.on('device:connected', (d) => forwardEvent('device:connected', d));
    deviceManager.on('device:disconnected', (d) => forwardEvent('device:disconnected', d));
    deviceManager.on('device:updated', (d) => forwardEvent('device:updated', d));
    deviceManager.on('groups:updated', (g) => forwardEvent('groups:updated', g));
    deviceManager.on('master:changed', (s) => forwardEvent('master:changed', s));
    sessionManager.on('sessionStarted', (s) => forwardEvent('session:started', { serial: s }));
    sessionManager.on('sessionStopped', (s) => forwardEvent('session:stopped', { serial: s }));

    log.info('WebSocket servers started');
  }

  _handleControlConnection(ws) {
    log.info('Control client connected');
    this.controlClients.add(ws);

    // Send current state
    ws.send(JSON.stringify({
      type: 'init',
      data: {
        devices: deviceManager.getAllDevices(),
        groups: deviceManager.getAllGroups(),
        sessions: sessionManager.getActiveSessions(),
        master: deviceManager.masterSerial,
      },
    }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await this._handleControlMessage(ws, msg);
      } catch (err) {
        log.error('Control message error', { error: err.message });
        ws.send(JSON.stringify({ type: 'error', data: { message: err.message } }));
      }
    });

    ws.on('close', () => {
      this.controlClients.delete(ws);
      log.info('Control client disconnected');
    });
  }

  async _handleControlMessage(ws, msg) {
    switch (msg.type) {
      case 'input:touch': {
        const { serial, action, x, y, width, height } = msg.data;
        sessionManager.injectTouch(serial, action, x, y, width, height);

        // If this is the master device, broadcast to slaves
        if (serial === deviceManager.masterSerial) {
          batchController.broadcastTouch(action, x, y, width, height);
        }
        break;
      }
      case 'input:key': {
        const { serial, action, keyCode, repeat, metaState } = msg.data;
        sessionManager.injectKey(serial, action, keyCode, repeat, metaState);

        if (serial === deviceManager.masterSerial) {
          batchController.broadcastKey(action, keyCode, repeat, metaState);
        }
        break;
      }
      case 'input:text': {
        const { serial, text } = msg.data;
        sessionManager.injectText(serial, text);

        if (serial === deviceManager.masterSerial) {
          batchController.broadcastText(text);
        }
        break;
      }
      case 'input:scroll': {
        const { serial, x, y, scrollX, scrollY, width, height } = msg.data;
        sessionManager.injectScroll(serial, x, y, scrollX, scrollY, width, height);

        if (serial === deviceManager.masterSerial) {
          batchController.broadcastScroll(x, y, scrollX, scrollY, width, height);
        }
        break;
      }
      case 'input:clipboard': {
        const { serial, text, paste } = msg.data;
        sessionManager.setClipboard(serial, text, paste !== false);
        // If master, broadcast clipboard to slaves
        if (serial === deviceManager.masterSerial) {
          for (const slave of deviceManager.getSlaveDevices()) {
            sessionManager.setClipboard(slave.serial, text, paste !== false);
          }
        }
        break;
      }
      default:
        log.warn('Unknown control message type', { type: msg.type });
    }
  }

  _handleVideoConnection(ws, req) {
    const url = new URL(req.url, 'http://localhost');
    const serial = url.searchParams.get('serial');
    const token = url.searchParams.get('token');

    if (!serial) {
      ws.close(4000, 'Missing serial parameter');
      return;
    }

    // Validate share token if provided (for remote access)
    if (token) {
      if (!shareManager.isSerialAllowed(token, serial)) {
        ws.close(4001, 'Invalid or expired share token');
        return;
      }
    }

    log.info('Video subscriber connected', { serial });

    if (!this.videoSubscribers.has(serial)) {
      this.videoSubscribers.set(serial, new Set());
    }
    this.videoSubscribers.get(serial).add(ws);

    // Send stream info
    const session = sessionManager.getSession(serial);
    if (session) {
      ws.send(JSON.stringify({
        type: 'stream_info',
        width: session.screenWidth,
        height: session.screenHeight,
        deviceName: session.deviceName,
      }));
    }

    // Send cached config + keyframe so late-joining subscribers can start rendering
    const cache = this.videoCache.get(serial);
    if (cache) {
      if (cache.config) ws.send(cache.config);
      if (cache.keyframe) ws.send(cache.keyframe);
    }

    ws.on('close', () => {
      const subs = this.videoSubscribers.get(serial);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) this.videoSubscribers.delete(serial);
      }
      log.info('Video subscriber disconnected', { serial });
    });
  }

  _handleSignalingConnection(ws, req) {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const role = url.searchParams.get('role'); // 'host' or 'client'

    log.info('Signaling connection', { role, hasToken: !!token });

    ws.role = role;
    ws.shareToken = token;

    if (token) {
      const share = shareManager.validateToken(token);
      if (!share) {
        ws.close(4001, 'Invalid share token');
        return;
      }
      ws.shareSerial = share.serial;
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this._handleSignalingMessage(ws, msg);
      } catch (err) {
        log.error('Signaling message error', { error: err.message });
      }
    });

    ws.on('close', () => {
      log.info('Signaling connection closed', { role });
    });
  }

  _handleSignalingMessage(ws, msg) {
    // Relay signaling messages (offer, answer, ice-candidate) between host and client
    const target = msg.target; // 'host' or 'client'

    this.signalingWss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN && client.role === target) {
        // Ensure same share context
        if (ws.shareSerial && client.shareSerial === ws.shareSerial) {
          client.send(JSON.stringify(msg));
        } else if (!ws.shareSerial && !client.shareSerial) {
          client.send(JSON.stringify(msg));
        }
      }
    });
  }

  broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const ws of this.controlClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
}

export const wsServer = new WsServer();
