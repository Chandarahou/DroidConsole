import { useState, useEffect, useCallback, useRef } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { PowerButton } from './PowerButton';
import { VideoSocket, ControlSocket } from '../services/websocket';
import * as api from '../services/api';
import './ReceivedPanel.css';

/**
 * ReceivedPanel — lets the receiver paste a share code (ip:port|token),
 * connect to a remote DroidConsole host, and view/control the shared devices.
 */
export function ReceivedPanel() {
  const [shareCode, setShareCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  // Active connections: array of { hostUrl, wsBase, token, share, controlSocket }
  const [connections, setConnections] = useState([]);

  // Load saved connections from localStorage on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('apm_received_shares') || '[]');
      // Reconnect saved shares automatically
      for (const entry of saved) {
        if (entry.hostUrl && entry.token) {
          connectToShare(entry.hostUrl, entry.token, true);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Save active connections to localStorage
  const saveConnections = useCallback((conns) => {
    const toSave = conns.map(c => ({ hostUrl: c.hostUrl, token: c.token }));
    localStorage.setItem('apm_received_shares', JSON.stringify(toSave));
  }, []);

  const parseShareCode = (code) => {
    const trimmed = code.trim();
    // Format: ip:port|token
    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx === -1) return null;

    const hostPart = trimmed.substring(0, pipeIdx);
    const token = trimmed.substring(pipeIdx + 1);

    if (!hostPart || !token) return null;

    // Detect tunnel URLs (e.g. xxx.loca.lt) — they require https/wss.
    // LAN addresses (ip:port) use plain http/ws.
    const isTunnel = hostPart.includes('.loca.lt') || hostPart.includes('.ngrok');
    const protocol = isTunnel ? 'https' : 'http';
    const wsProtocol = isTunnel ? 'wss' : 'ws';
    const hostUrl = `${protocol}://${hostPart}`;
    const wsBase = `${wsProtocol}://${hostPart}`;
    return { hostUrl, wsBase, token };
  };

  const connectToShare = async (hostUrl, token, silent = false) => {
    // Check if already connected to this token
    if (connections.find(c => c.token === token)) {
      if (!silent) setError('Already connected to this share');
      return;
    }

    if (!silent) {
      setConnecting(true);
      setError('');
    }

    try {
      // Validate the share token against the remote host
      const res = await api.remoteValidateShare(hostUrl, token);
      const share = res.share;

      // Extract wsBase from hostUrl
      const wsBase = hostUrl.replace(/^http/, 'ws');

      // Create a dedicated control socket for this remote host
      const ctrl = new ControlSocket();
      ctrl._remoteWsBase = wsBase;

      const newConn = {
        hostUrl,
        wsBase,
        token,
        share,
        controlSocket: ctrl,
      };

      setConnections(prev => {
        const updated = [...prev, newConn];
        saveConnections(updated);
        return updated;
      });

      // Connect the control socket to the remote host with the share token
      // so the server can enforce permission scoping.
      ctrl.connectToRemote(wsBase, token);

      if (!silent) setShareCode('');
    } catch (err) {
      if (!silent) setError(err.message || 'Failed to connect. Check the share code and network.');
    } finally {
      if (!silent) setConnecting(false);
    }
  };

  const handleConnect = async () => {
    const parsed = parseShareCode(shareCode);
    if (!parsed) {
      setError('Invalid share code format. Expected: ip:port|token');
      return;
    }
    await connectToShare(parsed.hostUrl, parsed.token);
  };

  const handleDisconnect = (token) => {
    setConnections(prev => {
      const conn = prev.find(c => c.token === token);
      if (conn?.controlSocket) {
        conn.controlSocket.disconnect();
      }
      const updated = prev.filter(c => c.token !== token);
      saveConnections(updated);
      return updated;
    });
  };

  const handleRefresh = async (token) => {
    const conn = connections.find(c => c.token === token);
    if (!conn) return;
    try {
      const res = await api.remoteValidateShare(conn.hostUrl, token);
      setConnections(prev =>
        prev.map(c => c.token === token ? { ...c, share: res.share } : c)
      );
    } catch (err) {
      setError(`Refresh failed: ${err.message}`);
    }
  };

  const formatExpiry = (expiresAt) => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'Expired';
    const mins = Math.floor(remaining / 60000);
    if (mins < 60) return `${mins}m left`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m left`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h left`;
  };

  return (
    <div className="received-panel">
      <h3>Received Shares</h3>

      {/* Connect form */}
      <div className="received-connect-form">
        <label className="received-label">Paste Share Code</label>
        <div className="received-input-row">
          <input
            className="received-code-input"
            placeholder="e.g. 192.168.1.100:3001|a1b2c3d4..."
            value={shareCode}
            onChange={e => { setShareCode(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
          />
          <button
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={!shareCode.trim() || connecting}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
        {error && <p className="received-error">{error}</p>}
        <p className="received-hint">
          Get a share code from someone running DroidConsole with connected devices.
          Works on the same LAN. For internet, the sharer can enable Internet Sharing in the Remote Share tab (no port forwarding needed).
        </p>
      </div>

      {/* Active connections */}
      {connections.length > 0 && (
        <div className="received-connections">
          <h4>Connected Shares ({connections.length})</h4>
          {connections.map(conn => (
            <ReceivedConnection
              key={conn.token}
              conn={conn}
              onDisconnect={handleDisconnect}
              onRefresh={handleRefresh}
              formatExpiry={formatExpiry}
            />
          ))}
        </div>
      )}

      {connections.length === 0 && (
        <div className="received-empty">
          <p>No received shares yet.</p>
          <p>Paste a share code above to connect to another DroidConsole instance.</p>
        </div>
      )}
    </div>
  );
}

/**
 * A single received connection with its shared devices + video players.
 */
function ReceivedConnection({ conn, onDisconnect, onRefresh, formatExpiry }) {
  const { hostUrl, wsBase, token, share, controlSocket } = conn;
  const [expanded, setExpanded] = useState(true);
  const [displayScale, setDisplayScale] = useState(50);

  const canvasWidth = Math.round(180 + (displayScale / 100) * 200);
  const canvasHeight = Math.round(400 + (displayScale / 100) * 440);

  const deviceCount = share.devices?.length || 0;
  const gridCols = deviceCount <= 1 ? 1 : deviceCount <= 4 ? 2 : deviceCount <= 9 ? 3 : 4;

  return (
    <div className="received-conn">
      <div className="received-conn-header">
        <div className="received-conn-info">
          <button className="received-expand-btn" onClick={() => setExpanded(p => !p)}>
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
          <span className="received-conn-name">
            {share.name ? `From: ${share.name}` : 'Shared Devices'}
          </span>
          <span className="received-conn-badge">
            {share.permissions?.view && 'View'}
            {share.permissions?.view && share.permissions?.control && ' + '}
            {share.permissions?.control && 'Control'}
          </span>
          <span className="received-conn-count">{deviceCount} device{deviceCount !== 1 ? 's' : ''}</span>
          <span className="received-conn-expiry">{formatExpiry(share.expiresAt)}</span>
          <span className="received-conn-host">{hostUrl.replace('http://', '')}</span>
        </div>
        <div className="received-conn-actions">
          <div className="received-scale-row">
            <input
              type="range"
              min="0"
              max="100"
              value={displayScale}
              onChange={e => setDisplayScale(Number(e.target.value))}
              className="received-scale-slider"
              title="Display size"
            />
          </div>
          <button className="btn btn-small btn-secondary" onClick={() => onRefresh(token)}>Refresh</button>
          <button className="btn btn-small btn-danger" onClick={() => onDisconnect(token)}>Disconnect</button>
        </div>
      </div>

      {expanded && (
        <div className="received-devices-grid" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
          {share.devices?.map(device => (
            <div key={device.serial} className="received-device-cell">
              <div className="received-device-label">
                <span className={`received-dot ${device.connected ? 'online' : 'offline'}`} />
                <span className="received-device-title">{device.name}</span>
                {device.connected && share.permissions?.control && (
                  <RemotePowerButton hostUrl={hostUrl} serial={device.serial} />
                )}
              </div>
              {device.connected ? (
                <RemoteVideoPlayer
                  serial={device.serial}
                  deviceName={device.name}
                  token={token}
                  wsBase={wsBase}
                  controlSocket={controlSocket}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  allowControl={share.permissions?.control}
                />
              ) : (
                <div className="received-device-offline" style={{ width: canvasWidth, height: canvasHeight }}>
                  <p>Device offline</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * RemoteVideoPlayer — like VideoPlayer but connects WebSocket to a remote host.
 */
function RemoteVideoPlayer({ serial, deviceName, token, wsBase, controlSocket, canvasWidth, canvasHeight, allowControl }) {
  const canvasRef = useRef(null);
  const videoDimRef = useRef({ w: 0, h: 0 });
  const CANVAS_W = canvasWidth;
  const CANVAS_H = canvasHeight;

  function computeVideoRect(cW, cH, vW, vH) {
    if (!vW || !vH) return { x: 0, y: 0, w: cW, h: cH };
    const scale = Math.min(cW / vW, cH / vH);
    const w = Math.round(vW * scale);
    const h = Math.round(vH * scale);
    return { x: Math.round((cW - w) / 2), y: Math.round((cH - h) / 2), w, h };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    let decoder = null;
    let configData = null;
    let hasReceivedKeyFrame = false;

    if (typeof VideoDecoder !== 'undefined') {
      decoder = new VideoDecoder({
        output: (frame) => {
          const vw = frame.displayWidth;
          const vh = frame.displayHeight;
          videoDimRef.current = { w: vw, h: vh };
          const rect = computeVideoRect(CANVAS_W, CANVAS_H, vw, vh);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
          ctx.drawImage(frame, rect.x, rect.y, rect.w, rect.h);
          frame.close();
        },
        error: (err) => {
          console.error('Decoder error:', err);
          hasReceivedKeyFrame = false;
          if (decoder.state === 'closed') return;
          try { decoder.reset(); } catch { /* ignore */ }
          try { decoder.configure({ codec: 'avc1.640028', optimizeForLatency: true }); } catch { /* ignore */ }
        },
      });

      decoder.configure({ codec: 'avc1.42001f', optimizeForLatency: true });
    }

    // Connect video WebSocket to the REMOTE host
    const params = new URLSearchParams({ serial });
    if (token) params.set('token', token);

    const ws = new WebSocket(`${wsBase}/ws/video?${params}`);
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') return; // stream_info JSON
      if (!decoder || decoder.state !== 'configured') return;

      const data = new Uint8Array(event.data);
      if (data.length < 2) return;

      const flags = data[0];
      const nalData = data.subarray(1);
      const isConfig = (flags & 0x01) !== 0;
      const isKeyFrame = (flags & 0x02) !== 0;

      if (isConfig) {
        configData = nalData.slice();
        for (let i = 0; i < nalData.length - 4; i++) {
          if (nalData[i] === 0 && nalData[i+1] === 0 && nalData[i+2] === 0 && nalData[i+3] === 1 && (nalData[i+4] & 0x1f) === 7) {
            const profile = nalData[i+5];
            const compat = nalData[i+6];
            const level = nalData[i+7];
            const codecStr = `avc1.${profile.toString(16).padStart(2,'0')}${compat.toString(16).padStart(2,'0')}${level.toString(16).padStart(2,'0')}`;
            try { decoder.configure({ codec: codecStr, optimizeForLatency: true }); } catch { /* fallback */ }
            break;
          }
        }
        return;
      }

      if (!hasReceivedKeyFrame && !isKeyFrame) return;

      try {
        let frameData;
        if (isKeyFrame && configData) {
          frameData = new Uint8Array(configData.length + nalData.length);
          frameData.set(configData, 0);
          frameData.set(nalData, configData.length);
        } else {
          frameData = nalData;
        }

        decoder.decode(new EncodedVideoChunk({
          type: isKeyFrame ? 'key' : 'delta',
          timestamp: performance.now() * 1000,
          data: frameData,
        }));
        hasReceivedKeyFrame = true;
      } catch (err) {
        console.warn('Decode error:', err.message);
        hasReceivedKeyFrame = false;
      }
    };

    return () => {
      ws.close();
      if (decoder && decoder.state !== 'closed') {
        try { decoder.close(); } catch { /* ignore */ }
      }
    };
  }, [serial, token, wsBase, CANVAS_W, CANVAS_H]);

  // --- Touch/keyboard input (routed to the remote host's control WebSocket) ---
  const mapMouseToVideo = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { w: vw, h: vh } = videoDimRef.current;
    if (!vw || !vh) return null;
    const elemRect = canvas.getBoundingClientRect();
    const mx = e.clientX - elemRect.left;
    const my = e.clientY - elemRect.top;
    const scaleX = canvas.width / elemRect.width;
    const scaleY = canvas.height / elemRect.height;
    const cx = mx * scaleX;
    const cy = my * scaleY;
    const vidRect = computeVideoRect(CANVAS_W, CANVAS_H, vw, vh);
    const rx = (cx - vidRect.x) / vidRect.w;
    const ry = (cy - vidRect.y) / vidRect.h;
    return { x: Math.max(0, Math.min(1, rx)), y: Math.max(0, Math.min(1, ry)) };
  }, [CANVAS_W, CANVAS_H]);

  const handleMouseEvent = useCallback((e, action) => {
    if (!allowControl) return;
    const pos = mapMouseToVideo(e);
    if (!pos) return;
    controlSocket?.sendTouch(serial, action, pos.x, pos.y, 1, 1);
  }, [serial, mapMouseToVideo, controlSocket, allowControl]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    canvasRef.current?.focus();
    handleMouseEvent(e, 0);
  }, [handleMouseEvent]);

  const handleMouseUp = useCallback((e) => {
    e.preventDefault();
    handleMouseEvent(e, 1);
  }, [handleMouseEvent]);

  const handleMouseMove = useCallback((e) => {
    if (e.buttons === 1) handleMouseEvent(e, 2);
  }, [handleMouseEvent]);

  useEffect(() => {
    if (!allowControl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      const pos = mapMouseToVideo(e);
      if (!pos) return;
      controlSocket?.sendScroll(serial, pos.x, pos.y, Math.sign(-e.deltaX), Math.sign(-e.deltaY), 1, 1);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [serial, mapMouseToVideo, controlSocket, allowControl]);

  const handleKeyDown = useCallback((e) => {
    if (!allowControl) return;
    e.preventDefault();
    const keyCode = mapKeyCode(e.code);
    if (keyCode !== null) {
      controlSocket?.sendKey(serial, 0, keyCode, 0, getMetaState(e));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      controlSocket?.sendText(serial, e.key);
    }
  }, [serial, controlSocket, allowControl]);

  const handleKeyUp = useCallback((e) => {
    if (!allowControl) return;
    e.preventDefault();
    const keyCode = mapKeyCode(e.code);
    if (keyCode !== null) {
      controlSocket?.sendKey(serial, 1, keyCode, 0, getMetaState(e));
    }
  }, [serial, controlSocket, allowControl]);

  return (
    <div className="video-player">
      <div className="video-header">
        <span className="video-serial">{deviceName || serial}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="video-canvas"
        width={CANVAS_W}
        height={CANVAS_H}
        tabIndex={allowControl ? 0 : -1}
        onMouseDown={allowControl ? handleMouseDown : undefined}
        onMouseUp={allowControl ? handleMouseUp : undefined}
        onMouseMove={allowControl ? handleMouseMove : undefined}
        onKeyDown={allowControl ? handleKeyDown : undefined}
        onKeyUp={allowControl ? handleKeyUp : undefined}
        style={{ cursor: allowControl ? 'pointer' : 'default' }}
      />
    </div>
  );
}

/**
 * Power button that sends the command to the remote host.
 */
function RemotePowerButton({ hostUrl, serial }) {
  const [loading, setLoading] = useState(false);

  const handlePower = useCallback(async () => {
    setLoading(true);
    try {
      await api.remoteRequest(hostUrl, '/api/batch/shell', {
        method: 'POST',
        body: JSON.stringify({ serials: [serial], command: 'input keyevent 26' }),
      });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [hostUrl, serial]);

  return (
    <button className="power-btn" onClick={handlePower} disabled={loading} title="Power on/off">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="2" x2="12" y2="12" />
        <path d="M16.24 7.76a6 6 0 1 1-8.49 0" />
      </svg>
    </button>
  );
}

// --- Key mapping (same as VideoPlayer) ---

function mapKeyCode(code) {
  const MAP = {
    ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
    Escape: 4, Home: 3, F5: 82,
    Backspace: 67, Delete: 112, Enter: 23, Tab: 61, Space: 62,
    VolumeUp: 24, VolumeDown: 25, F1: 224, F2: 225,
  };
  return MAP[code] ?? null;
}

function getMetaState(e) {
  let state = 0;
  if (e.shiftKey) state |= 1;
  if (e.ctrlKey) state |= 0x1000;
  if (e.altKey) state |= 0x02;
  return state;
}

