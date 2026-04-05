import { adbClient } from '../adb/adb-client.js';
import { deviceManager } from '../adb/device-manager.js';
import { sessionManager } from '../scrcpy/session-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('BatchController');

export class BatchController {
  /**
   * Run a callback on multiple devices in parallel, returning results.
   */
  async _runOnDevices(serials, fn) {
    const targets = serials || deviceManager.getAllDevices()
      .filter(d => d.status === 'device')
      .map(d => d.serial);

    const results = await Promise.allSettled(
      targets.map(async (serial) => {
        try {
          const result = await fn(serial);
          return { serial, success: true, data: result };
        } catch (err) {
          return { serial, success: false, error: err.message };
        }
      })
    );

    return results.map(r => r.status === 'fulfilled' ? r.value : {
      serial: 'unknown',
      success: false,
      error: r.reason?.message,
    });
  }

  async installApk(serials, apkPath) {
    log.info('Batch install APK', { serials, apkPath });
    return this._runOnDevices(serials, (serial) => adbClient.installApk(serial, apkPath));
  }

  async clearData(serials, packageName) {
    log.info('Batch clear data', { serials, packageName });
    return this._runOnDevices(serials, (serial) => adbClient.clearAppData(serial, packageName));
  }

  async reboot(serials) {
    log.info('Batch reboot', { serials });
    return this._runOnDevices(serials, (serial) => adbClient.reboot(serial));
  }

  async shellCommand(serials, command) {
    log.info('Batch shell command', { serials, command });
    return this._runOnDevices(serials, (serial) => adbClient.shell(serial, command));
  }

  async screenshot(serials) {
    log.info('Batch screenshot', { serials });
    return this._runOnDevices(serials, (serial) => adbClient.screenshot(serial));
  }

  // --- Input Broadcast (Master -> Slaves) ---

  broadcastTouch(action, x, y, width, height) {
    const slaves = deviceManager.getSlaveDevices();
    for (const slave of slaves) {
      sessionManager.injectTouch(slave.serial, action, x, y, width, height);
    }
  }

  broadcastKey(action, keyCode, repeat, metaState) {
    const slaves = deviceManager.getSlaveDevices();
    for (const slave of slaves) {
      sessionManager.injectKey(slave.serial, action, keyCode, repeat, metaState);
    }
  }

  broadcastText(text) {
    const slaves = deviceManager.getSlaveDevices();
    for (const slave of slaves) {
      sessionManager.injectText(slave.serial, text);
    }
  }

  broadcastScroll(x, y, scrollX, scrollY, width, height) {
    const slaves = deviceManager.getSlaveDevices();
    for (const slave of slaves) {
      sessionManager.injectScroll(slave.serial, x, y, scrollX, scrollY, width, height);
    }
  }
}

export const batchController = new BatchController();
