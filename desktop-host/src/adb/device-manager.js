import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { adbClient } from './adb-client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('DeviceManager');
const POLL_INTERVAL = 3000;
const NICKNAMES_FILE = process.env.NICKNAMES_PATH ||
  decodeURIComponent(new URL('../../data/nicknames.json', import.meta.url).pathname)
    .replace(/^\/([A-Za-z]:)/, '$1');

export class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.groups = new Map();
    this.masterSerial = null;
    this.pollTimer = null;
    this.nicknames = this._loadNicknames();
  }

  _loadNicknames() {
    try {
      if (existsSync(NICKNAMES_FILE)) {
        const data = JSON.parse(readFileSync(NICKNAMES_FILE, 'utf8'));
        log.info('Loaded nicknames', { count: Object.keys(data).length });
        return new Map(Object.entries(data));
      }
    } catch (err) {
      log.warn('Failed to load nicknames', { error: err.message });
    }
    return new Map();
  }

  _saveNicknames() {
    try {
      const dir = dirname(NICKNAMES_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(NICKNAMES_FILE, JSON.stringify(Object.fromEntries(this.nicknames), null, 2));
    } catch (err) {
      log.warn('Failed to save nicknames', { error: err.message });
    }
  }

  async start() {
    log.info('Starting device manager');
    await this.refresh();
    this.pollTimer = setInterval(() => this.refresh(), POLL_INTERVAL);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async refresh() {
    try {
      const adbDevices = await adbClient.listDevices();
      const currentSerials = new Set(adbDevices.map(d => d.serial));
      const previousSerials = new Set(this.devices.keys());

      // Detect new devices
      for (const adbDev of adbDevices) {
        if (!previousSerials.has(adbDev.serial)) {
          // New device detected
          let info = {};
          if (adbDev.status === 'device') {
            try {
              info = await adbClient.getDeviceInfo(adbDev.serial);
            } catch (err) {
              log.error('Failed to get device info', { serial: adbDev.serial, error: err.message });
            }
          }
          const device = {
            ...adbDev,
            ...info,
            nickname: this.nicknames.get(adbDev.serial) || null,
            groupId: null,
            isMaster: false,
            mirrorState: 'idle',
            connectedAt: Date.now(),
          };
          this.devices.set(adbDev.serial, device);
          log.info('Device detected', { serial: adbDev.serial, status: adbDev.status, model: info.model });
          this.emit('device:connected', device);

          // If unauthorized, try to get info once it becomes authorized
          if (adbDev.status === 'unauthorized') {
            log.warn('Device unauthorized — accept USB debugging on the device', { serial: adbDev.serial });
          }
        } else if (previousSerials.has(adbDev.serial)) {
          // Update status of existing device
          const existing = this.devices.get(adbDev.serial);
          if (existing.status !== adbDev.status) {
            const wasUnauthorized = existing.status === 'unauthorized';
            existing.status = adbDev.status;

            // Fetch full device info once authorized
            if (wasUnauthorized && adbDev.status === 'device') {
              try {
                const info = await adbClient.getDeviceInfo(adbDev.serial);
                Object.assign(existing, info);
                log.info('Device authorized', { serial: adbDev.serial, model: info.model });
              } catch (err) {
                log.error('Failed to get device info after auth', { error: err.message });
              }
            }
            this.emit('device:updated', existing);
          }
        }
      }

      // Detect disconnected devices
      for (const serial of previousSerials) {
        if (!currentSerials.has(serial)) {
          const device = this.devices.get(serial);
          this.devices.delete(serial);
          log.info('Device disconnected', { serial });
          this.emit('device:disconnected', { serial, device });
        }
      }
    } catch (err) {
      log.error('Refresh failed', { error: err.message });
    }
  }

  getDevice(serial) {
    return this.devices.get(serial) || null;
  }

  getAllDevices() {
    return Array.from(this.devices.values());
  }

  renameDevice(serial, nickname) {
    const device = this.devices.get(serial);
    if (!device) return false;
    device.nickname = nickname;
    // Persist by serial so it survives restarts and reconnects
    if (nickname) {
      this.nicknames.set(serial, nickname);
    } else {
      this.nicknames.delete(serial);
    }
    this._saveNicknames();
    this.emit('device:updated', device);
    return true;
  }

  // --- Group Management ---

  createGroup(name) {
    const id = `group_${Date.now()}`;
    this.groups.set(id, { id, name, deviceSerials: [] });
    this.emit('groups:updated', this.getAllGroups());
    return id;
  }

  deleteGroup(groupId) {
    const group = this.groups.get(groupId);
    if (!group) return false;
    for (const serial of group.deviceSerials) {
      const device = this.devices.get(serial);
      if (device) device.groupId = null;
    }
    this.groups.delete(groupId);
    this.emit('groups:updated', this.getAllGroups());
    return true;
  }

  addDeviceToGroup(serial, groupId) {
    const group = this.groups.get(groupId);
    const device = this.devices.get(serial);
    if (!group || !device) return false;

    if (device.groupId) {
      this.removeDeviceFromGroup(serial, device.groupId);
    }

    group.deviceSerials.push(serial);
    device.groupId = groupId;
    this.emit('device:updated', device);
    this.emit('groups:updated', this.getAllGroups());
    return true;
  }

  removeDeviceFromGroup(serial, groupId) {
    const group = this.groups.get(groupId);
    const device = this.devices.get(serial);
    if (!group) return false;

    group.deviceSerials = group.deviceSerials.filter(s => s !== serial);
    if (device) device.groupId = null;
    this.emit('groups:updated', this.getAllGroups());
    return true;
  }

  getAllGroups() {
    return Array.from(this.groups.values());
  }

  // --- Master/Slave ---

  setMaster(serial) {
    if (this.masterSerial) {
      const prev = this.devices.get(this.masterSerial);
      if (prev) prev.isMaster = false;
    }
    this.masterSerial = serial;
    const device = this.devices.get(serial);
    if (device) device.isMaster = true;
    this.emit('master:changed', serial);
    return true;
  }

  clearMaster() {
    if (this.masterSerial) {
      const prev = this.devices.get(this.masterSerial);
      if (prev) prev.isMaster = false;
    }
    this.masterSerial = null;
    this.emit('master:changed', null);
  }

  getSlaveDevices() {
    return this.getAllDevices().filter(d => !d.isMaster && d.status === 'device');
  }
}

export const deviceManager = new DeviceManager();
