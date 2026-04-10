import { createConnection } from 'node:net';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { adbClient } from '../adb/adb-client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ScrcpyClient');

// When ADB_HOST is set (Docker), adb forward opens ports on the ADB host, not localhost.
// Socket connections must go to the ADB host to reach the forwarded port.
const FORWARD_HOST = process.env.ADB_HOST || '127.0.0.1';

const SCRCPY_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar';
const LOCAL_JAR_PATH = process.env.SCRCPY_JAR_PATH ||
  decodeURIComponent(new URL('../../vendor/scrcpy-server.jar', import.meta.url).pathname)
    .replace(/^\/([A-Za-z]:)/, '$1'); // Fix Windows path

/**
 * Manages a scrcpy session for a single device.
 * Compatible with scrcpy-server v3.x protocol.
 *
 * Protocol (tunnel_forward=true, v3.x):
 *   1. Push jar, set up adb forward (localabstract:scrcpy), start server
 *   2. Wait for "[server] INFO: Device:" on stderr
 *   3. Connect video socket → receives: dummy byte (1) + device name (64) + codec info (12) + H.264 stream
 *   4. Connect control socket → receives: dummy byte (1), then accepts control messages
 *   Both sockets must connect before the server begins streaming.
 */
export class ScrcpyClient extends EventEmitter {
  constructor(serial, options = {}) {
    super();
    this.serial = serial;
    this.options = {
      maxSize: options.maxSize || 1024,
      bitRate: options.bitRate || 4_000_000,
      maxFps: options.maxFps || 30,
      ...options,
    };
    this.videoSocket = null;
    this.controlSocket = null;
    this.serverProcess = null;
    this.localPort = 0;
    this.running = false;
    this.deviceName = '';
    this.screenWidth = 0;
    this.screenHeight = 0;
    this._serverVersion = '';
  }

  async start() {
    if (this.running) return;
    log.info('Starting scrcpy session', { serial: this.serial });

    try {
      // Push scrcpy-server.jar to device
      await this._pushServer();

      // Detect server version
      this._serverVersion = await this._detectVersion();
      log.info('scrcpy-server version', { version: this._serverVersion });

      // Allocate a local port
      this.localPort = 27183 + Math.floor(Math.random() * 1000);

      // Set up adb forward: local TCP port → device abstract socket
      await adbClient.exec(
        ['forward', `tcp:${this.localPort}`, 'localabstract:scrcpy'],
        this.serial
      );
      log.info('ADB forward set', { port: this.localPort });

      // Start scrcpy-server on the device
      await this._startServer();

      // Wait briefly for the server to open its abstract socket after printing "Device:"
      await new Promise(resolve => setTimeout(resolve, 500));

      // Connect video + control sockets (both must connect before stream begins)
      // Retry connection a few times since the abstract socket may not be ready yet
      await this._connectSocketsWithRetry(3);

      this.running = true;
      this.emit('started', { serial: this.serial });
    } catch (err) {
      log.error('Failed to start scrcpy session', { serial: this.serial, error: err.message });
      await this.stop();
      throw err;
    }
  }

  async _pushServer() {
    if (!existsSync(LOCAL_JAR_PATH)) {
      throw new Error(
        `scrcpy-server.jar not found at ${LOCAL_JAR_PATH}. ` +
        'Download it from https://github.com/Genymobile/scrcpy/releases and place it in desktop-host/vendor/'
      );
    }

    // Always push to ensure the correct version is on the device
    await adbClient.pushFile(this.serial, LOCAL_JAR_PATH, SCRCPY_SERVER_PATH);
    log.info('Pushed scrcpy-server.jar to device');
  }

  // Cache version globally — only detect once per process lifetime
  static _cachedVersion = null;

  async _detectVersion() {
    if (ScrcpyClient._cachedVersion) return ScrcpyClient._cachedVersion;

    try {
      const out = await adbClient.exec(
        ['shell', `CLASSPATH=${SCRCPY_SERVER_PATH} app_process / com.genymobile.scrcpy.Server 0.0`],
        this.serial
      );
      const match = out.match(/server version \(([^)]+)\)/);
      if (match) { ScrcpyClient._cachedVersion = match[1]; return match[1]; }
    } catch (err) {
      const match = err.message?.match(/server version \(([^)]+)\)/);
      if (match) { ScrcpyClient._cachedVersion = match[1]; return match[1]; }
    }
    ScrcpyClient._cachedVersion = '3.3.4';
    return '3.3.4';
  }

  _startServer() {
    return new Promise((resolve, reject) => {
      // Pass entire command as a single shell string so CLASSPATH is set correctly
      const shellCmd = [
        `CLASSPATH=${SCRCPY_SERVER_PATH}`,
        'app_process', '/',
        'com.genymobile.scrcpy.Server',
        this._serverVersion,
        'tunnel_forward=true',
        `max_size=${this.options.maxSize}`,
        `max_fps=${this.options.maxFps}`,
        `video_bit_rate=${this.options.bitRate}`,
        'video_codec=h264',
        'audio=false',
        'control=true',
        'keyboard=uhid',
        'cleanup=false',
        'power_off_on_close=false',
        'stay_awake=true',
      ].join(' ');

      this.serverProcess = adbClient.spawn(['shell', shellCmd], this.serial);

      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('scrcpy-server startup timed out'));
        }
      }, 10000);

      // Server prints to stdout when using '2>&1', but normally stderr
      const onData = (data) => {
        const msg = data.toString();
        log.debug('scrcpy-server', { output: msg.trim() });

        if (msg.includes('Device:') && !resolved) {
          resolved = true;
          clearTimeout(timer);
          log.info('scrcpy-server ready');
          resolve();
        }
      };

      this.serverProcess.stdout.on('data', onData);
      this.serverProcess.stderr.on('data', onData);

      this.serverProcess.on('close', (code) => {
        log.info('scrcpy-server exited', { serial: this.serial, code });
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(new Error(`scrcpy-server exited with code ${code}`));
        }
        this.running = false;
        this.emit('stopped', { serial: this.serial, code });
      });
    });
  }

  async _connectSocketsWithRetry(maxRetries) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this._connectSockets();
        return;
      } catch (err) {
        log.warn(`Socket connection attempt ${attempt}/${maxRetries} failed`, { error: err.message });
        // Clean up failed sockets
        if (this.videoSocket) { this.videoSocket.destroy(); this.videoSocket = null; }
        if (this.controlSocket) { this.controlSocket.destroy(); this.controlSocket = null; }
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        } else {
          throw err;
        }
      }
    }
  }

  _connectSockets() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 8000);

      // Buffer all video data from the start (before control connects)
      let headerBuf = Buffer.alloc(0);
      let headerParsed = false;

      const onVideoData = (data) => {
        if (!headerParsed) {
          headerBuf = Buffer.concat([headerBuf, data]);
          log.debug('Video header buffered', { total: headerBuf.length });

          // v3 header: 1 byte dummy + 64 bytes device name + 12 bytes codec info = 77 bytes
          if (headerBuf.length >= 77) {
            headerParsed = true;

            // Skip dummy byte (offset 0)
            this.deviceName = headerBuf.subarray(1, 65).toString('utf8').replace(/\0/g, '').trim();

            // Codec info: 4 bytes codec id + 4 bytes width + 4 bytes height
            this.screenWidth = headerBuf.readUInt32BE(69);
            this.screenHeight = headerBuf.readUInt32BE(73);

            log.info('Device info from scrcpy', {
              name: this.deviceName,
              width: this.screenWidth,
              height: this.screenHeight,
            });

            clearTimeout(timer);
            resolve();

            // Initialize the frame parser for scrcpy v3 packet format
            this._initFrameParser();

            // Feed remaining data into the frame parser
            const remaining = headerBuf.subarray(77);
            if (remaining.length > 0) {
              this._feedParser(remaining);
            }
          }
        } else {
          this._feedParser(data);
        }
      };

      log.info('Connecting video socket', { port: this.localPort });
      this.videoSocket = createConnection({ port: this.localPort, host: FORWARD_HOST });

      // Start listening for data immediately on connect
      this.videoSocket.on('connect', () => {
        log.info('Video socket connected');
        this.videoSocket.on('data', onVideoData);

        // Small delay before control socket — server needs time to accept the video
        // socket before it's ready for the control socket connection.
        setTimeout(() => {
          log.info('Connecting control socket');
          this.controlSocket = createConnection({ port: this.localPort, host: FORWARD_HOST });

          this.controlSocket.on('connect', () => {
            log.info('Control socket connected, waiting for video header...');
            // Drain incoming data from control socket (dummy byte + device messages)
            this.controlSocket.on('data', () => {});
          });

          this.controlSocket.on('error', (err) => {
            log.error('Control socket error', { error: err.message });
            clearTimeout(timer);
            // Clean up the already-connected video socket to prevent leak
            try { this.videoSocket.destroy(); } catch {}
            reject(err);
          });
        }, 200);
      });

      this.videoSocket.on('error', (err) => {
        log.error('Video socket error', { error: err.message });
        clearTimeout(timer);
        // Clean up control socket if it was already created
        try { if (this.controlSocket) this.controlSocket.destroy(); } catch {}
        reject(err);
      });
    });
  }

  // --- Frame Parser ---
  // scrcpy v3 video stream format (after 77-byte header):
  //   [8 bytes PTS (BE uint64)] [4 bytes packet_size (BE uint32)] [packet_size bytes H.264 data]
  //   PTS high bit (0x80) = config packet (SPS/PPS), 0x40 = key frame
  //
  // We parse these and emit each frame as a tagged binary message:
  //   [1 byte flags: 0x01=config, 0x02=keyframe] [H.264 NAL data]

  _initFrameParser() {
    this._parserBuf = Buffer.alloc(0);
  }

  _feedParser(data) {
    this._parserBuf = Buffer.concat([this._parserBuf, data]);

    while (this._parserBuf.length >= 12) {
      // Read PTS (8 bytes) and packet size (4 bytes)
      const ptsHigh = this._parserBuf.readUInt32BE(0);
      const packetSize = this._parserBuf.readUInt32BE(8);

      if (packetSize === 0 || packetSize > 5 * 1024 * 1024) {
        // Invalid packet size — stream may be corrupted, skip a byte
        log.warn('Invalid packet size, resync', { packetSize });
        this._parserBuf = this._parserBuf.subarray(1);
        continue;
      }

      const totalNeeded = 12 + packetSize;
      if (this._parserBuf.length < totalNeeded) {
        // Need more data
        break;
      }

      // Extract the H.264 payload
      const payload = this._parserBuf.subarray(12, totalNeeded);
      this._parserBuf = this._parserBuf.subarray(totalNeeded);

      // Determine frame type from PTS flags + NAL unit inspection
      const isConfig = (ptsHigh & 0x80000000) !== 0; // SPS/PPS
      let isKeyFrame = (ptsHigh & 0x40000000) !== 0;  // IDR flag in PTS

      // Also detect keyframe by scanning for IDR NAL type (5) or SPS (7) in the payload
      if (!isKeyFrame && !isConfig && payload.length >= 5) {
        for (let i = 0; i < payload.length - 4; i++) {
          if (payload[i] === 0 && payload[i+1] === 0 && payload[i+2] === 0 && payload[i+3] === 1) {
            const nalType = payload[i+4] & 0x1f;
            if (nalType === 5) { isKeyFrame = true; break; }
            if (nalType === 7) { isKeyFrame = true; break; } // SPS before IDR
          }
        }
      }

      // Build tagged frame: [1 byte flags] [H.264 data]
      const flags = (isConfig ? 0x01 : 0) | (isKeyFrame ? 0x02 : 0);
      const taggedFrame = Buffer.alloc(1 + payload.length);
      taggedFrame.writeUInt8(flags, 0);
      payload.copy(taggedFrame, 1);

      this.emit('videoData', taggedFrame);
    }
  }

  // --- Control Input Methods ---

  // --- scrcpy v3.x control message format ---
  // Type 0: inject_keycode  (14 bytes)
  // Type 1: inject_text     (5 + len bytes)
  // Type 2: inject_touch    (32 bytes) — was 28 in v2!
  // Type 3: inject_scroll   (25 bytes) — was 21 in v2!

  injectTouch(action, x, y, width, height) {
    if (!this.controlSocket || !this.running) return;

    const deviceX = Math.round((x / width) * this.screenWidth);
    const deviceY = Math.round((y / height) * this.screenHeight);
    const isDown = action === 0 || action === 2;

    const buf = Buffer.alloc(32);
    buf.writeUInt8(2, 0);               // type: inject_touch_event
    buf.writeUInt8(action, 1);          // action: 0=down, 1=up, 2=move
    buf.writeBigInt64BE(BigInt(-1), 2); // pointerId (-1 = mouse)
    buf.writeInt32BE(deviceX, 10);      // position.x
    buf.writeInt32BE(deviceY, 14);      // position.y
    buf.writeUInt16BE(this.screenWidth, 18);  // screen width
    buf.writeUInt16BE(this.screenHeight, 20); // screen height
    buf.writeUInt16BE(isDown ? 0xFFFF : 0, 22); // pressure
    buf.writeUInt32BE(isDown ? 1 : 0, 24);  // actionButton (PRIMARY)
    buf.writeUInt32BE(isDown ? 1 : 0, 28);  // buttons (PRIMARY)

    this.controlSocket.write(buf);
  }

  // --- UHID Keyboard ---
  // Creates a virtual USB HID keyboard device on the Android side.
  // This bypasses app-level input filtering (e.g. WhatsApp registration).

  _uhidKeyboardCreated = false;
  _uhidKeyboardId = 1;
  _pressedHidKeys = new Set();

  _createUhidKeyboard() {
    if (this._uhidKeyboardCreated || !this.controlSocket) return;

    // Standard USB HID keyboard report descriptor (65 bytes, matches scrcpy's)
    const reportDesc = Buffer.from([
      0x05, 0x01,       // Usage Page (Generic Desktop)
      0x09, 0x06,       // Usage (Keyboard)
      0xA1, 0x01,       // Collection (Application)
      // Modifier keys (8 bits)
      0x05, 0x07,       //   Usage Page (Key Codes)
      0x19, 0xE0,       //   Usage Minimum (224) - Left Control
      0x29, 0xE7,       //   Usage Maximum (231) - Right GUI
      0x15, 0x00,       //   Logical Minimum (0)
      0x25, 0x01,       //   Logical Maximum (1)
      0x75, 0x01,       //   Report Size (1)
      0x95, 0x08,       //   Report Count (8)
      0x81, 0x02,       //   Input (Data, Variable, Absolute)
      // Reserved byte
      0x75, 0x08,       //   Report Size (8)
      0x95, 0x01,       //   Report Count (1)
      0x81, 0x01,       //   Input (Constant)
      // LEDs (output report — 5 indicators + 3 padding)
      0x05, 0x08,       //   Usage Page (LEDs)
      0x19, 0x01,       //   Usage Minimum (1) - Num Lock
      0x29, 0x05,       //   Usage Maximum (5) - Kana
      0x75, 0x01,       //   Report Size (1)
      0x95, 0x05,       //   Report Count (5)
      0x91, 0x02,       //   Output (Data, Variable, Absolute)
      0x75, 0x03,       //   Report Size (3) - padding
      0x95, 0x01,       //   Report Count (1)
      0x91, 0x01,       //   Output (Constant)
      // Key array (6 keys)
      0x05, 0x07,       //   Usage Page (Key Codes)
      0x19, 0x00,       //   Usage Minimum (0)
      0x29, 0x65,       //   Usage Maximum (101)
      0x15, 0x00,       //   Logical Minimum (0)
      0x25, 0x65,       //   Logical Maximum (101)
      0x75, 0x08,       //   Report Size (8)
      0x95, 0x06,       //   Report Count (6)
      0x81, 0x00,       //   Input (Data, Array)
      0xC0,             // End Collection
    ]);

    const name = Buffer.from('DroidConsole Virtual Keyboard', 'utf8');

    // UHID_CREATE: type(1) + id(2) + vendor_id(2) + product_id(2) + name_len(1) + name + report_desc_len(2) + report_desc
    const buf = Buffer.alloc(1 + 2 + 2 + 2 + 1 + name.length + 2 + reportDesc.length);
    let offset = 0;
    buf.writeUInt8(12, offset); offset += 1;                       // type: UHID_CREATE
    buf.writeUInt16BE(this._uhidKeyboardId, offset); offset += 2;  // id
    buf.writeUInt16BE(0x0000, offset); offset += 2;                // vendor_id (generic)
    buf.writeUInt16BE(0x0000, offset); offset += 2;                // product_id (generic)
    buf.writeUInt8(name.length, offset); offset += 1;              // name length
    name.copy(buf, offset); offset += name.length;                 // name
    buf.writeUInt16BE(reportDesc.length, offset); offset += 2;     // report desc length
    reportDesc.copy(buf, offset);                                  // report descriptor

    this.controlSocket.write(buf);
    this._uhidKeyboardCreated = true;
    log.info('UHID keyboard created', { msgSize: buf.length, reportDescSize: reportDesc.length });
  }

  _sendUhidKeyReport(modifiers, keys) {
    if (!this.controlSocket || !this.running) return;

    // HID keyboard report: [modifiers, 0x00, key1, key2, key3, key4, key5, key6]
    const report = Buffer.alloc(8);
    report.writeUInt8(modifiers, 0);
    report.writeUInt8(0, 1); // reserved
    const keyArray = Array.from(keys).slice(0, 6);
    for (let i = 0; i < keyArray.length; i++) {
      report.writeUInt8(keyArray[i], 2 + i);
    }

    // UHID_INPUT: type(1) + id(2) + size(2) + data(size)
    const buf = Buffer.alloc(1 + 2 + 2 + report.length);
    buf.writeUInt8(13, 0);                               // type: UHID_INPUT
    buf.writeUInt16BE(this._uhidKeyboardId, 1);          // id
    buf.writeUInt16BE(report.length, 3);                 // size
    report.copy(buf, 5);                                 // HID report

    this.controlSocket.write(buf);
  }

  injectKeyEvent(action, keyCode, repeat, metaState) {
    if (!this.controlSocket || !this.running) {
      log.warn('injectKeyEvent skipped', { hasSocket: !!this.controlSocket, running: this.running });
      return;
    }

    // Ensure UHID keyboard is created
    this._createUhidKeyboard();

    // Map Android keycode to USB HID keycode
    const hidKey = ANDROID_TO_HID[keyCode];
    if (hidKey === undefined) {
      // Fallback to SDK inject for unmapped keys
      log.debug('injectKeyEvent fallback to SDK', { keyCode });
      const buf = Buffer.alloc(14);
      buf.writeUInt8(0, 0);
      buf.writeUInt8(action, 1);
      buf.writeInt32BE(keyCode, 2);
      buf.writeInt32BE(repeat || 0, 6);
      buf.writeInt32BE(metaState || 0, 10);
      this.controlSocket.write(buf);
      return;
    }

    // Build modifier byte from metaState
    let modifiers = 0;
    if (metaState & 0x1000) modifiers |= 0x01; // Left Ctrl
    if (metaState & 1) modifiers |= 0x02;      // Left Shift
    if (metaState & 0x02) modifiers |= 0x04;   // Left Alt

    if (action === 0) {
      // Key down
      this._pressedHidKeys.add(hidKey);
    } else {
      // Key up
      this._pressedHidKeys.delete(hidKey);
    }

    this._sendUhidKeyReport(modifiers, this._pressedHidKeys);
  }

  injectText(text) {
    if (!this.controlSocket || !this.running) return;

    // Ensure UHID keyboard is created
    this._createUhidKeyboard();

    // Type each character via UHID key press/release
    for (const char of text) {
      const mapping = CHAR_TO_HID[char] || CHAR_TO_HID[char.toLowerCase()];
      if (mapping) {
        const { key, shift } = mapping;
        const mod = shift ? 0x02 : 0; // Left Shift
        this._sendUhidKeyReport(mod, new Set([key]));
        // Small delay between press and release isn't needed for UHID,
        // but we send release immediately
        this._sendUhidKeyReport(0, new Set());
      } else {
        // Fallback to inject_text for characters we can't map
        const textBytes = Buffer.from(char, 'utf8');
        const buf = Buffer.alloc(5 + textBytes.length);
        buf.writeUInt8(1, 0);
        buf.writeInt32BE(textBytes.length, 1);
        textBytes.copy(buf, 5);
        this.controlSocket.write(buf);
      }
    }
  }

  /**
   * Push text to the device clipboard, optionally pasting immediately.
   * scrcpy v3 SET_CLIPBOARD message (type 9):
   *   type(1) + sequence(8) + paste(1) + length(4) + text(length)
   */
  setClipboard(text, paste = true) {
    if (!this.controlSocket || !this.running) return;

    const textBytes = Buffer.from(text, 'utf8');
    const buf = Buffer.alloc(1 + 8 + 1 + 4 + textBytes.length);
    let offset = 0;
    buf.writeUInt8(9, offset); offset += 1;                  // type: SET_CLIPBOARD
    buf.writeBigUInt64BE(BigInt(0), offset); offset += 8;    // sequence (0 = no ack)
    buf.writeUInt8(paste ? 1 : 0, offset); offset += 1;      // paste flag
    buf.writeUInt32BE(textBytes.length, offset); offset += 4; // text length
    textBytes.copy(buf, offset);                              // text bytes

    this.controlSocket.write(buf);
    log.debug('Clipboard set', { length: textBytes.length, paste });
  }

  injectScroll(x, y, scrollX, scrollY, width, height) {
    if (!this.controlSocket || !this.running) return;

    const deviceX = Math.round((x / width) * this.screenWidth);
    const deviceY = Math.round((y / height) * this.screenHeight);

    // v3 scroll: 21 bytes
    // type(1) + position(x:4 + y:4 + w:2 + h:2 = 12) + hscroll(i16:2) + vscroll(i16:2) + buttons(i32:4) = 21
    const buf = Buffer.alloc(21);
    buf.writeUInt8(3, 0);
    buf.writeInt32BE(deviceX, 1);
    buf.writeInt32BE(deviceY, 5);
    buf.writeUInt16BE(this.screenWidth, 9);
    buf.writeUInt16BE(this.screenHeight, 11);
    buf.writeInt16BE(Math.max(-1, Math.min(1, scrollX)), 13);
    buf.writeInt16BE(Math.max(-1, Math.min(1, scrollY)), 15);
    buf.writeInt32BE(0, 17);

    this.controlSocket.write(buf);
  }

  async stop() {
    log.info('Stopping scrcpy session', { serial: this.serial });
    this.running = false;

    if (this.controlSocket) {
      this.controlSocket.destroy();
      this.controlSocket = null;
    }
    if (this.videoSocket) {
      this.videoSocket.destroy();
      this.videoSocket = null;
    }
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }

    this._uhidKeyboardCreated = false;
    this._pressedHidKeys.clear();

    try {
      await adbClient.removeForward(this.serial, this.localPort);
    } catch { /* ignore */ }
  }
}

// --- Android Keycode → USB HID Keycode mapping ---
// Reference: USB HID Usage Tables (Keyboard/Keypad Page 0x07)
const ANDROID_TO_HID = {
  // DPAD / Navigation
  19: 0x52,  // DPAD_UP    → Up Arrow
  20: 0x51,  // DPAD_DOWN  → Down Arrow
  21: 0x50,  // DPAD_LEFT  → Left Arrow
  22: 0x4F,  // DPAD_RIGHT → Right Arrow
  23: 0x28,  // DPAD_CENTER→ Enter (Return)
  66: 0x28,  // ENTER      → Enter (Return)

  // Android nav
  4: 0x29,   // BACK       → Escape
  3: 0x4A,   // HOME       → Home (HID)

  // Digits 0-9 (KEYCODE_0=7 .. KEYCODE_9=16)
  7: 0x27,   // 0
  8: 0x1E,   // 1
  9: 0x1F,   // 2
  10: 0x20,  // 3
  11: 0x21,  // 4
  12: 0x22,  // 5
  13: 0x23,  // 6
  14: 0x24,  // 7
  15: 0x25,  // 8
  16: 0x26,  // 9

  // Letters A-Z (KEYCODE_A=29 .. KEYCODE_Z=54)
  29: 0x04, 30: 0x05, 31: 0x06, 32: 0x07, 33: 0x08,
  34: 0x09, 35: 0x0A, 36: 0x0B, 37: 0x0C, 38: 0x0D,
  39: 0x0E, 40: 0x0F, 41: 0x10, 42: 0x11, 43: 0x12,
  44: 0x13, 45: 0x14, 46: 0x15, 47: 0x16, 48: 0x17,
  49: 0x18, 50: 0x19, 51: 0x1A, 52: 0x1B, 53: 0x1C,
  54: 0x1D,

  // Editing
  67: 0x2A,  // DEL (Backspace)
  112: 0x4C, // FORWARD_DEL → Delete
  61: 0x2B,  // TAB
  62: 0x2C,  // SPACE

  // Volume (fallback to SDK, but map for completeness)
  24: undefined, // VOLUME_UP   → no HID equivalent (handled by system)
  25: undefined, // VOLUME_DOWN → no HID equivalent

  // F-keys
  82: 0x45,  // MENU → F12 (as app switch shortcut)

  // Numpad digits
  144: 0x62, 145: 0x59, 146: 0x5A, 147: 0x5B, 148: 0x5C,
  149: 0x5D, 150: 0x5E, 151: 0x5F, 152: 0x60, 153: 0x61,
};

// --- Character → USB HID key mapping (for text injection) ---
const CHAR_TO_HID = {
  'a': { key: 0x04, shift: false }, 'b': { key: 0x05, shift: false },
  'c': { key: 0x06, shift: false }, 'd': { key: 0x07, shift: false },
  'e': { key: 0x08, shift: false }, 'f': { key: 0x09, shift: false },
  'g': { key: 0x0A, shift: false }, 'h': { key: 0x0B, shift: false },
  'i': { key: 0x0C, shift: false }, 'j': { key: 0x0D, shift: false },
  'k': { key: 0x0E, shift: false }, 'l': { key: 0x0F, shift: false },
  'm': { key: 0x10, shift: false }, 'n': { key: 0x11, shift: false },
  'o': { key: 0x12, shift: false }, 'p': { key: 0x13, shift: false },
  'q': { key: 0x14, shift: false }, 'r': { key: 0x15, shift: false },
  's': { key: 0x16, shift: false }, 't': { key: 0x17, shift: false },
  'u': { key: 0x18, shift: false }, 'v': { key: 0x19, shift: false },
  'w': { key: 0x1A, shift: false }, 'x': { key: 0x1B, shift: false },
  'y': { key: 0x1C, shift: false }, 'z': { key: 0x1D, shift: false },
  'A': { key: 0x04, shift: true }, 'B': { key: 0x05, shift: true },
  'C': { key: 0x06, shift: true }, 'D': { key: 0x07, shift: true },
  'E': { key: 0x08, shift: true }, 'F': { key: 0x09, shift: true },
  'G': { key: 0x0A, shift: true }, 'H': { key: 0x0B, shift: true },
  'I': { key: 0x0C, shift: true }, 'J': { key: 0x0D, shift: true },
  'K': { key: 0x0E, shift: true }, 'L': { key: 0x0F, shift: true },
  'M': { key: 0x10, shift: true }, 'N': { key: 0x11, shift: true },
  'O': { key: 0x12, shift: true }, 'P': { key: 0x13, shift: true },
  'Q': { key: 0x14, shift: true }, 'R': { key: 0x15, shift: true },
  'S': { key: 0x16, shift: true }, 'T': { key: 0x17, shift: true },
  'U': { key: 0x18, shift: true }, 'V': { key: 0x19, shift: true },
  'W': { key: 0x1A, shift: true }, 'X': { key: 0x1B, shift: true },
  'Y': { key: 0x1C, shift: true }, 'Z': { key: 0x1D, shift: true },
  '0': { key: 0x27, shift: false }, '1': { key: 0x1E, shift: false },
  '2': { key: 0x1F, shift: false }, '3': { key: 0x20, shift: false },
  '4': { key: 0x21, shift: false }, '5': { key: 0x22, shift: false },
  '6': { key: 0x23, shift: false }, '7': { key: 0x24, shift: false },
  '8': { key: 0x25, shift: false }, '9': { key: 0x26, shift: false },
  ' ': { key: 0x2C, shift: false },
  '.': { key: 0x37, shift: false }, ',': { key: 0x36, shift: false },
  '-': { key: 0x2D, shift: false }, '+': { key: 0x2E, shift: true },
  '@': { key: 0x1F, shift: true }, // Shift+2
  '!': { key: 0x1E, shift: true }, '#': { key: 0x20, shift: true },
  '$': { key: 0x21, shift: true }, '%': { key: 0x22, shift: true },
  '&': { key: 0x24, shift: true }, '*': { key: 0x25, shift: true },
  '(': { key: 0x26, shift: true }, ')': { key: 0x27, shift: true },
  '_': { key: 0x2D, shift: true }, '=': { key: 0x2E, shift: false },
  '/': { key: 0x38, shift: false }, '\\': { key: 0x31, shift: false },
  ';': { key: 0x33, shift: false }, ':': { key: 0x33, shift: true },
  '\'': { key: 0x34, shift: false }, '"': { key: 0x34, shift: true },
  '[': { key: 0x2F, shift: false }, ']': { key: 0x30, shift: false },
  '\n': { key: 0x28, shift: false }, // Enter
};
