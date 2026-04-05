import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { networkInterfaces } from 'node:os';
import { deviceManager } from '../adb/device-manager.js';
import { sessionManager } from '../scrcpy/session-manager.js';
import { batchController } from './batch-controller.js';
import { adbClient } from '../adb/adb-client.js';
import { shareManager } from './share-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('HTTP');

export function createHttpServer() {
  const app = express();

  app.use(cors());
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json());

  // --- Device endpoints ---

  app.get('/api/devices', (req, res) => {
    res.json({ devices: deviceManager.getAllDevices() });
  });

  app.get('/api/devices/:serial', (req, res) => {
    const device = deviceManager.getDevice(req.params.serial);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ device });
  });

  app.post('/api/devices/:serial/rename', (req, res) => {
    const { nickname } = req.body;
    const ok = deviceManager.renameDevice(req.params.serial, nickname);
    if (!ok) return res.status(404).json({ error: 'Device not found' });
    res.json({ success: true });
  });

  app.post('/api/devices/connect-tcp', async (req, res) => {
    try {
      const { ip, port } = req.body;
      const ok = await adbClient.connectTcpDevice(ip, port);
      res.json({ success: ok });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/devices/:serial/disconnect', async (req, res) => {
    try {
      await adbClient.disconnectTcpDevice(req.params.serial);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Mirroring endpoints ---

  app.get('/api/sessions', (req, res) => {
    res.json({ sessions: sessionManager.getActiveSessions() });
  });

  app.post('/api/sessions/:serial/start', async (req, res) => {
    try {
      await sessionManager.startSession(req.params.serial, req.body);
      res.json({ success: true });
    } catch (err) {
      log.error('Failed to start session', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sessions/:serial/stop', async (req, res) => {
    await sessionManager.stopSession(req.params.serial);
    res.json({ success: true });
  });

  // --- Group endpoints ---

  app.get('/api/groups', (req, res) => {
    res.json({ groups: deviceManager.getAllGroups() });
  });

  app.post('/api/groups', (req, res) => {
    const id = deviceManager.createGroup(req.body.name);
    res.json({ id });
  });

  app.delete('/api/groups/:id', (req, res) => {
    deviceManager.deleteGroup(req.params.id);
    res.json({ success: true });
  });

  app.post('/api/groups/:id/add-device', (req, res) => {
    deviceManager.addDeviceToGroup(req.body.serial, req.params.id);
    res.json({ success: true });
  });

  app.post('/api/groups/:id/remove-device', (req, res) => {
    deviceManager.removeDeviceFromGroup(req.body.serial, req.params.id);
    res.json({ success: true });
  });

  // --- Master/Slave endpoints ---

  app.post('/api/master/set', (req, res) => {
    deviceManager.setMaster(req.body.serial);
    res.json({ success: true });
  });

  app.post('/api/master/clear', (req, res) => {
    deviceManager.clearMaster();
    res.json({ success: true });
  });

  app.get('/api/master/slaves', (req, res) => {
    res.json({ slaves: deviceManager.getSlaveDevices() });
  });

  // --- Batch operations ---

  app.post('/api/batch/install-apk', async (req, res) => {
    const { serials, apkPath } = req.body;
    const results = await batchController.installApk(serials, apkPath);
    res.json({ results });
  });

  app.post('/api/batch/clear-data', async (req, res) => {
    const { serials, packageName } = req.body;
    const results = await batchController.clearData(serials, packageName);
    res.json({ results });
  });

  app.post('/api/batch/reboot', async (req, res) => {
    const { serials } = req.body;
    const results = await batchController.reboot(serials);
    res.json({ results });
  });

  app.post('/api/batch/shell', async (req, res) => {
    const { serials, command } = req.body;
    const results = await batchController.shellCommand(serials, command);
    res.json({ results });
  });

  app.post('/api/batch/screenshot', async (req, res) => {
    const { serials } = req.body;
    const results = await batchController.screenshot(serials);
    res.json({
      results: results.map(r => ({
        serial: r.serial,
        success: r.success,
        error: r.error,
        image: r.data ? `data:image/png;base64,${r.data.toString('base64')}` : null,
      })),
    });
  });

  // --- Share endpoints ---

  app.post('/api/share/create', (req, res) => {
    const serials = req.body.serials || (req.body.serial ? [req.body.serial] : []);
    const { expiresInMinutes, permissions, name } = req.body;
    if (serials.length === 0) return res.status(400).json({ error: 'No devices selected' });
    if (!name?.trim()) return res.status(400).json({ error: 'Share name is required' });
    const share = shareManager.createShare(serials, { expiresInMinutes, permissions, name: name.trim() });
    res.json({ share });
  });

  app.get('/api/share/list', (req, res) => {
    res.json({ shares: shareManager.getActiveShares() });
  });

  app.post('/api/share/:token/update-devices', (req, res) => {
    const { serials } = req.body;
    if (!serials || serials.length === 0) return res.status(400).json({ error: 'At least one device required' });
    const share = shareManager.updateShareDevices(req.params.token, serials);
    if (!share) return res.status(404).json({ error: 'Share not found or expired' });
    res.json({ success: true, serials: share.serials });
  });

  app.post('/api/share/:token/revoke', (req, res) => {
    shareManager.revokeShare(req.params.token);
    res.json({ success: true });
  });

  app.get('/api/share/:token/validate', async (req, res) => {
    const share = shareManager.validateToken(req.params.token);
    if (!share) return res.status(403).json({ error: 'Invalid or expired share' });

    // Auto-start mirroring sessions for all shared devices
    for (const serial of share.serials) {
      if (!sessionManager.getSession(serial)) {
        try {
          await sessionManager.startSession(serial);
        } catch (err) {
          log.warn('Auto-start mirror for share failed', { serial, error: err.message });
        }
      }
    }

    // Return device info for each shared serial
    const devices = share.serials.map(serial => {
      const dev = deviceManager.getDevice(serial);
      return {
        serial,
        name: dev?.nickname || dev?.deviceName || dev?.model || serial,
        model: dev?.model,
        connected: !!dev && dev.status === 'device',
      };
    });

    res.json({ share: { name: share.name, serials: share.serials, devices, permissions: share.permissions, expiresAt: share.expiresAt } });
  });

  // --- Network Info (for remote sharing) ---

  app.get('/api/network-info', (req, res) => {
    const interfaces = networkInterfaces();
    const addresses = [];
    for (const [name, nets] of Object.entries(interfaces)) {
      for (const net of nets) {
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push({ name, address: net.address });
        }
      }
    }
    const port = parseInt(process.env.PORT || '3001', 10);
    res.json({ addresses, port });
  });

  // --- Health ---

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      devices: deviceManager.getAllDevices().length,
      sessions: sessionManager.getActiveSessions().length,
    });
  });

  return app;
}
