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
const GROUPS_FILE = process.env.GROUPS_PATH ||
  decodeURIComponent(new URL('../../data/groups.json', import.meta.url).pathname)
    .replace(/^\/([A-Za-z]:)/, '$1');

export class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.groups = new Map();
    this.masterSerial = null;
    this.pollTimer = null;
    this.nicknames = this._loadNicknames();
    this._loadGroups();
  }

  _loadGroups() {
    try {
      if (existsSync(GROUPS_FILE)) {
        const data = JSON.parse(readFileSync(GROUPS_FILE, 'utf8'));
        for (const g of data) {
          // Stored shape matches in-memory shape: { id, name, deviceSerials: [] }
          this.groups.set(g.id, { id: g.id, name: g.name, deviceSerials: g.deviceSerials || [] });
        }
        log.info('Loaded groups', { count: this.groups.size });
      }
    } catch (err) {
      log.warn('Failed to load groups', { error: err.message });
    }
  }

  _saveGroups() {
    try {
      const dir = dirname(GROUPS_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(GROUPS_FILE, JSON.stringify(Array.from(this.groups.values()), null, 2));
    } catch (err) {
      // Loud — silent persistence failures cost us once already with warm-up.
      log.error('Failed to save groups', { error: err.message, file: GROUPS_FILE });
    }
  }

  // Look up which group a serial belongs to from the in-memory groups map.
  // Used when a device first appears so we can re-attach groupId from a
  // restored group file before any device record existed for it.
  _findGroupForSerial(serial) {
    for (const g of this.groups.values()) {
      if (g.deviceSerials.includes(serial)) return g.id;
    }
    return null;
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
            // Re-attach groupId from persisted groups so the device shows up
            // inside its group immediately after restart.
            groupId: this._findGroupForSerial(adbDev.serial),
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
    this._saveGroups();
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
    this._saveGroups();
    this.emit('groups:updated', this.getAllGroups());
    return true;
  }

  addDeviceToGroup(serial, groupId) {
    const group = this.groups.get(groupId);
    const device = this.devices.get(serial);
    // Allow adding by serial even if the device record doesn't exist yet
    // (e.g., restored from disk before first ADB poll completes).
    if (!group) return false;

    const previousGroupId = device?.groupId || this._findGroupForSerial(serial);
    if (previousGroupId && previousGroupId !== groupId) {
      this.removeDeviceFromGroup(serial, previousGroupId);
    }

    if (!group.deviceSerials.includes(serial)) {
      group.deviceSerials.push(serial);
    }
    if (device) {
      device.groupId = groupId;
      this.emit('device:updated', device);
    }
    this._saveGroups();
    this.emit('groups:updated', this.getAllGroups());
    return true;
  }

  removeDeviceFromGroup(serial, groupId) {
    const group = this.groups.get(groupId);
    const device = this.devices.get(serial);
    if (!group) return false;

    group.deviceSerials = group.deviceSerials.filter(s => s !== serial);
    if (device) device.groupId = null;
    this._saveGroups();
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
