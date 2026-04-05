import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const log = createLogger('ADB');

// Search for ADB in common locations
function findAdb() {
  // 1. Explicit env var
  if (process.env.ADB_PATH) return process.env.ADB_PATH;

  // 2. Common Windows locations
  const candidates = [];
  const localAppData = process.env.LOCALAPPDATA;
  const userProfile = process.env.USERPROFILE;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];

  if (localAppData) {
    candidates.push(`${localAppData}\\Android\\Sdk\\platform-tools\\adb.exe`);
  }
  if (userProfile) {
    candidates.push(`${userProfile}\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe`);
    candidates.push(`${userProfile}\\Android\\Sdk\\platform-tools\\adb.exe`);
  }
  if (programFiles) {
    candidates.push(`${programFiles}\\Android\\platform-tools\\adb.exe`);
    candidates.push(`${programFiles}\\Minimal ADB and Fastboot\\adb.exe`);
  }
  if (programFilesX86) {
    candidates.push(`${programFilesX86}\\Android\\platform-tools\\adb.exe`);
  }
  // User profile root (common manual install location)
  if (userProfile) {
    candidates.push(`${userProfile}\\adb.exe`);
    candidates.push(`${userProfile}\\platform-tools\\adb.exe`);
    candidates.push(`${userProfile}\\scrcpy\\adb.exe`);
    candidates.push(`${userProfile}\\Desktop\\platform-tools\\adb.exe`);
    candidates.push(`${userProfile}\\Downloads\\platform-tools\\adb.exe`);
  }
  // Scrcpy bundles, standalone installs
  candidates.push('C:\\adb\\adb.exe');
  candidates.push('C:\\platform-tools\\adb.exe');
  candidates.push('C:\\scrcpy\\adb.exe');

  // Also scan PATH directories for adb.exe
  const pathDirs = (process.env.PATH || '').split(';');
  for (const dir of pathDirs) {
    if (dir) candidates.push(`${dir}\\adb.exe`);
  }

  for (const p of candidates) {
    if (existsSync(p)) {
      log.info('Found ADB', { path: p });
      return p;
    }
  }

  // 3. Fallback: hope it's on PATH
  log.warn('ADB not found in known locations, falling back to "adb" on PATH');
  return 'adb';
}

const ADB_PATH = findAdb();

// For Docker: connect to ADB server on the host machine via network
// Set ADB_HOST=host.docker.internal to use host's ADB server
const ADB_HOST = process.env.ADB_HOST || '';
const ADB_PORT = process.env.ADB_PORT || '5037';

export class AdbClient {
  constructor() {
    this.devices = new Map();
  }

  _buildArgs(args, serial) {
    const hostArgs = ADB_HOST ? ['-H', ADB_HOST, '-P', ADB_PORT] : [];
    const serialArgs = serial ? ['-s', serial] : [];
    return [...hostArgs, ...serialArgs, ...args];
  }

  async exec(args, serial) {
    const fullArgs = this._buildArgs(args, serial);
    log.debug('exec', { args: fullArgs });
    try {
      const { stdout, stderr } = await execFileAsync(ADB_PATH, fullArgs, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (stderr && !stderr.includes('daemon')) {
        log.warn('stderr', { stderr: stderr.trim() });
      }
      return stdout.trim();
    } catch (err) {
      log.error('exec failed', { args: fullArgs, error: err.message });
      throw err;
    }
  }

  spawn(args, serial) {
    const fullArgs = this._buildArgs(args, serial);
    log.debug('spawn', { args: fullArgs });
    return spawn(ADB_PATH, fullArgs);
  }

  async listDevices() {
    const output = await this.exec(['devices', '-l']);
    const lines = output.split('\n').slice(1).filter(l => l.trim());
    const devices = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const serial = parts[0];
      const status = parts[1]; // device, unauthorized, offline
      const props = {};

      for (const part of parts.slice(2)) {
        const [key, value] = part.split(':');
        if (key && value) props[key] = value;
      }

      devices.push({
        serial,
        status,
        model: props.model || 'unknown',
        device: props.device || 'unknown',
        product: props.product || 'unknown',
        transportId: props.transport_id,
      });
    }

    return devices;
  }

  async getDeviceProperty(serial, prop) {
    return this.exec(['shell', 'getprop', prop], serial);
  }

  async getDeviceInfo(serial) {
    const [model, brand, version, sdk, resolution, density, deviceName] = await Promise.all([
      this.getDeviceProperty(serial, 'ro.product.model'),
      this.getDeviceProperty(serial, 'ro.product.brand'),
      this.getDeviceProperty(serial, 'ro.build.version.release'),
      this.getDeviceProperty(serial, 'ro.build.version.sdk'),
      this.exec(['shell', 'wm', 'size'], serial).then(o => {
        const m = o.match(/(\d+x\d+)/);
        return m ? m[1] : 'unknown';
      }),
      this.exec(['shell', 'wm', 'density'], serial).then(o => {
        const m = o.match(/(\d+)/);
        return m ? parseInt(m[1]) : 0;
      }),
      // Get the user-set device name (from phone Settings > About > Device name)
      this.exec(['shell', 'settings', 'get', 'secure', 'bluetooth_name'], serial).catch(() => ''),
    ]);

    const [w, h] = resolution.split('x').map(Number);
    const cleanDeviceName = deviceName && deviceName !== 'null' ? deviceName.trim() : '';

    return {
      serial,
      model,
      brand,
      androidVersion: version,
      sdkLevel: parseInt(sdk),
      screenWidth: w || 0,
      screenHeight: h || 0,
      density,
      deviceName: cleanDeviceName,
    };
  }

  async connectTcpDevice(ip, port = 5555) {
    const result = await this.exec(['connect', `${ip}:${port}`]);
    log.info('TCP connect', { ip, port, result });
    return result.includes('connected');
  }

  async disconnectTcpDevice(ip, port = 5555) {
    const result = await this.exec(['disconnect', `${ip}:${port}`]);
    log.info('TCP disconnect', { ip, port, result });
    return true;
  }

  async pushFile(serial, localPath, remotePath) {
    return this.exec(['push', localPath, remotePath], serial);
  }

  async installApk(serial, apkPath) {
    return this.exec(['install', '-r', apkPath], serial);
  }

  async shell(serial, command) {
    return this.exec(['shell', command], serial);
  }

  async forwardPort(serial, localPort, remoteSpec) {
    // remoteSpec can be "tcp:PORT" or "localabstract:NAME"
    const remote = remoteSpec.includes(':') ? remoteSpec : `tcp:${remoteSpec}`;
    return this.exec(['forward', `tcp:${localPort}`, remote], serial);
  }

  async removeForward(serial, localPort) {
    return this.exec(['forward', '--remove', `tcp:${localPort}`], serial);
  }

  async reboot(serial) {
    return this.exec(['reboot'], serial);
  }

  async clearAppData(serial, packageName) {
    return this.exec(['shell', 'pm', 'clear', packageName], serial);
  }

  async screenshot(serial) {
    const raw = await execFileAsync(ADB_PATH, ['-s', serial, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    });
    return raw.stdout;
  }

  async inputTap(serial, x, y) {
    return this.exec(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))], serial);
  }

  async inputSwipe(serial, x1, y1, x2, y2, duration = 300) {
    return this.exec([
      'shell', 'input', 'swipe',
      String(Math.round(x1)), String(Math.round(y1)),
      String(Math.round(x2)), String(Math.round(y2)),
      String(duration),
    ], serial);
  }

  async inputText(serial, text) {
    const escaped = text.replace(/ /g, '%s').replace(/'/g, "\\'");
    return this.exec(['shell', 'input', 'text', escaped], serial);
  }

  async inputKeyEvent(serial, keyCode) {
    return this.exec(['shell', 'input', 'keyevent', String(keyCode)], serial);
  }
}

export const adbClient = new AdbClient();
