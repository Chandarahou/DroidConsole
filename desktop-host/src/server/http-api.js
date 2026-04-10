import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { networkInterfaces } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import multer from 'multer';
import { deviceManager } from '../adb/device-manager.js';
import { sessionManager } from '../scrcpy/session-manager.js';
import { batchController } from './batch-controller.js';
import { adbClient } from '../adb/adb-client.js';
import { shareManager } from './share-manager.js';
import { warmupManager } from './warmup-manager.js';
import { createLogger } from '../utils/logger.js';

// Multer: store uploaded files in system temp dir, preserve original filename
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tmpdir()),
    filename: (req, file, cb) => cb(null, `droidconsole_${Date.now()}_${file.originalname}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB max
});

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

  // --- File Transfer (PC → Phone) ---
  // Accepts multipart upload, pushes the file to selected devices via ADB.
  app.post('/api/batch/push-file', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const serials = JSON.parse(req.body.serials || '[]');
    const remotePath = (req.body.remotePath || '/sdcard/Download/').replace(/\/$/, '')
      + '/' + req.file.originalname;
    const localPath = req.file.path;

    try {
      const results = await batchController.pushFile(serials, localPath, remotePath);
      res.json({ results, fileName: req.file.originalname, remotePath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      // Clean up temp file
      try { unlinkSync(localPath); } catch { /* ignore */ }
    }
  });

  // --- WhatsApp Register (UHID typing) ---

  // WhatsApp registration page focusable element order (via Tab):
  // 1. menuitem_overflow    2. scroll_view    3. description
  // 4. registration_country 5. registration_cc 6. registration_phone
  // 7. registration_submit (Next)

  async function waTypeOnDevice(session, phoneNumber, countryCode) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const tap = (keyCode) => { session.injectKeyEvent(0, keyCode, 0, 0); session.injectKeyEvent(1, keyCode, 0, 0); };
    const tabN = async (n) => { for (let i = 0; i < n; i++) { tap(61); await sleep(150); } };

    // Precondition: device must be on the clean WhatsApp registration page
    // (no dialogs, no popups — user should dismiss them before using this feature)

    // Flow (user-specified):
    // Input CC → 1 Tab → Input phone number → 1 Tab → Enter (Next)
    // → sleep 5s → 2 Tab → Enter (confirm "Yes")

    if (countryCode) {
      // Tab 5 to CC field (tab order: overflow, scroll, desc, country, cc)
      await tabN(5);
      await sleep(400);

      // Clear existing code: move cursor right, then backspace
      for (let i = 0; i < 5; i++) tap(22);
      await sleep(100);
      for (let i = 0; i < 5; i++) { tap(67); await sleep(100); }
      await sleep(300);

      // Type country code
      session.injectText(countryCode.replace(/\D/g, ''));
      await sleep(800);

      // 1 Tab to phone field
      await tabN(1);
      await sleep(400);
    } else {
      // No CC change — 6 tabs to phone field
      await tabN(6);
      await sleep(400);
    }

    // Type phone number
    const digits = phoneNumber.replace(/\D/g, '');
    session.injectText(digits);
    await sleep(800);

    // 1 Tab to Next button
    await tabN(1);
    await sleep(300);

    // Press Enter on Next
    tap(23);

    // Sleep 5 seconds — wait for confirm dialog ("Is this the correct number?")
    await sleep(5000);

    // 2 Tab to "Yes" button
    await tabN(2);
    await sleep(300);

    // Press Enter on "Yes"
    tap(23);

    return digits.length;
  }

  app.post('/api/wa-register/type', async (req, res) => {
    const { serial, phoneNumber, countryCode } = req.body;
    if (!serial || !phoneNumber) return res.status(400).json({ error: 'serial and phoneNumber required' });

    const session = sessionManager.getSession(serial);
    if (!session || !session.running) {
      return res.status(400).json({ error: 'No active mirror session for this device' });
    }

    try {
      const count = await waTypeOnDevice(session, phoneNumber, countryCode);
      res.json({ success: true, serial, digits: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/wa-register/batch', async (req, res) => {
    const { entries } = req.body; // [{ serial, phoneNumber, countryCode }]
    if (!entries || entries.length === 0) return res.status(400).json({ error: 'entries required' });

    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        const { serial, phoneNumber, countryCode } = entry;
        const session = sessionManager.getSession(serial);
        if (!session || !session.running) {
          return { serial, success: false, error: 'No active mirror session' };
        }
        try {
          const count = await waTypeOnDevice(session, phoneNumber, countryCode);
          return { serial, success: true, digits: count };
        } catch (err) {
          return { serial, success: false, error: err.message };
        }
      })
    );

    res.json({
      results: results.map(r => r.status === 'fulfilled' ? r.value : { serial: 'unknown', success: false, error: r.reason?.message })
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

  // --- WhatsApp Warm-Up ---

  app.get('/api/warmup/status', (req, res) => {
    res.json({ devices: warmupManager.getAllStates() });
  });

  app.get('/api/warmup/:serial', (req, res) => {
    const state = warmupManager.getState(req.params.serial);
    if (!state) return res.json({ state: null });
    res.json({ state, autoRunning: warmupManager.isAutoRunning(req.params.serial) });
  });

  app.post('/api/warmup/start', (req, res) => {
    const { serial, contacts, options } = req.body;
    if (!serial) return res.status(400).json({ error: 'serial required' });
    if (!contacts || contacts.length === 0) return res.status(400).json({ error: 'contacts required' });
    const state = warmupManager.startWarmup(serial, contacts, options);
    res.json({ state });
  });

  app.post('/api/warmup/stop', (req, res) => {
    warmupManager.stopWarmup(req.body.serial);
    res.json({ success: true });
  });

  app.post('/api/warmup/pause', (req, res) => {
    const state = warmupManager.togglePause(req.body.serial);
    res.json({ state });
  });

  app.post('/api/warmup/contacts', (req, res) => {
    const { serial, contacts } = req.body;
    const state = warmupManager.updateContacts(serial, contacts);
    res.json({ state });
  });

  app.post('/api/warmup/execute', async (req, res) => {
    const result = await warmupManager.executeAction(req.body.serial, { force: req.body.force, message: req.body.message });
    res.json(result);
  });

  app.post('/api/warmup/auto-start', (req, res) => {
    const ok = warmupManager.startAutoRun(req.body.serial);
    res.json({ success: ok });
  });

  app.post('/api/warmup/auto-stop', (req, res) => {
    warmupManager.stopAutoRun(req.body.serial);
    res.json({ success: true });
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

  // --- Internet Tunnel (localtunnel) ---
  let activeTunnel = null;

  app.post('/api/tunnel/start', async (req, res) => {
    if (activeTunnel) {
      return res.json({ url: activeTunnel.url, already: true });
    }
    try {
      const localtunnel = (await import('localtunnel')).default;
      const port = parseInt(process.env.PORT || '3001', 10);
      const tunnel = await localtunnel({ port });
      activeTunnel = tunnel;

      tunnel.on('close', () => {
        log.info('Tunnel closed');
        activeTunnel = null;
      });
      tunnel.on('error', (err) => {
        log.error('Tunnel error', { error: err.message });
        activeTunnel = null;
      });

      log.info('Tunnel opened', { url: tunnel.url });
      res.json({ url: tunnel.url });
    } catch (err) {
      log.error('Failed to open tunnel', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tunnel/stop', (req, res) => {
    if (activeTunnel) {
      activeTunnel.close();
      activeTunnel = null;
    }
    res.json({ success: true });
  });

  app.get('/api/tunnel/status', (req, res) => {
    res.json({
      active: !!activeTunnel,
      url: activeTunnel?.url || null,
    });
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
