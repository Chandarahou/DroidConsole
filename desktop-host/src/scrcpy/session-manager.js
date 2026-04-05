import { EventEmitter } from 'node:events';
import { ScrcpyClient } from './scrcpy-client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SessionManager');

export class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // serial -> ScrcpyClient
  }

  async startSession(serial, options = {}) {
    if (this.sessions.has(serial)) {
      log.warn('Session already exists', { serial });
      return this.sessions.get(serial);
    }

    const client = new ScrcpyClient(serial, options);

    client.on('videoData', (data) => {
      this.emit('videoData', serial, data);
    });

    client.on('stopped', ({ code }) => {
      log.info('Session stopped', { serial, code });
      this.sessions.delete(serial);
      this.emit('sessionStopped', serial);
    });

    this.sessions.set(serial, client);

    try {
      await client.start();
      log.info('Session started', { serial });
      this.emit('sessionStarted', serial);
      return client;
    } catch (err) {
      this.sessions.delete(serial);
      throw err;
    }
  }

  async stopSession(serial) {
    const client = this.sessions.get(serial);
    if (!client) return;
    await client.stop();
    this.sessions.delete(serial);
  }

  async stopAll() {
    const stops = Array.from(this.sessions.keys()).map(s => this.stopSession(s));
    await Promise.allSettled(stops);
  }

  getSession(serial) {
    return this.sessions.get(serial) || null;
  }

  getActiveSessions() {
    return Array.from(this.sessions.entries()).map(([serial, client]) => ({
      serial,
      running: client.running,
      deviceName: client.deviceName,
      screenWidth: client.screenWidth,
      screenHeight: client.screenHeight,
    }));
  }

  injectTouch(serial, action, x, y, width, height) {
    const client = this.sessions.get(serial);
    if (client) client.injectTouch(action, x, y, width, height);
  }

  injectKey(serial, action, keyCode, repeat, metaState) {
    const client = this.sessions.get(serial);
    if (client) client.injectKeyEvent(action, keyCode, repeat, metaState);
  }

  injectText(serial, text) {
    const client = this.sessions.get(serial);
    if (client) client.injectText(text);
  }

  injectScroll(serial, x, y, scrollX, scrollY, width, height) {
    const client = this.sessions.get(serial);
    if (client) client.injectScroll(x, y, scrollX, scrollY, width, height);
  }
}

export const sessionManager = new SessionManager();
