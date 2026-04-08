// Always connect WebSocket directly to desktop-host on port 3001.
// This avoids nginx proxy issues with binary video streaming.
const WS_BASE = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3001`;

export class ControlSocket {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectTimer = null;
    this.connected = false;
  }

  connectToRemote(wsBase) {
    this._remoteWsBase = wsBase;
    this.connect();
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    clearTimeout(this.reconnectTimer);

    const base = this._remoteWsBase || WS_BASE;
    this.ws = new WebSocket(`${base}/ws/control`);

    this.ws.onopen = () => {
      this.connected = true;
      this._emit('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._emit(msg.type, msg.data);
      } catch { /* ignore malformed messages */ }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this._emit('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  sendTouch(serial, action, x, y, width, height) {
    this.send('input:touch', { serial, action, x, y, width, height });
  }

  sendKey(serial, action, keyCode, repeat, metaState) {
    this.send('input:key', { serial, action, keyCode, repeat, metaState });
  }

  sendText(serial, text) {
    this.send('input:text', { serial, text });
  }

  sendScroll(serial, x, y, scrollX, scrollY, width, height) {
    this.send('input:scroll', { serial, x, y, scrollX, scrollY, width, height });
  }

  sendClipboard(serial, text, paste = true) {
    this.send('input:clipboard', { serial, text, paste });
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  _emit(event, data) {
    const cbs = this.listeners.get(event);
    if (cbs) cbs.forEach(cb => cb(data));
  }
}

export class VideoSocket {
  constructor(serial, token) {
    this.serial = serial;
    this.token = token;
    this.ws = null;
    this.onData = null;
    this.onInfo = null;
  }

  connect() {
    const params = new URLSearchParams({ serial: this.serial });
    if (this.token) params.set('token', this.token);

    this.ws = new WebSocket(`${WS_BASE}/ws/video?${params}`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const info = JSON.parse(event.data);
          if (info.type === 'stream_info' && this.onInfo) {
            this.onInfo(info);
          }
        } catch { /* ignore */ }
      } else if (this.onData) {
        this.onData(new Uint8Array(event.data));
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton control socket
export const controlSocket = new ControlSocket();
