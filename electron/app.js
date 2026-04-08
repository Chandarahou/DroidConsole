import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog } = require('electron');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// --- Set environment variables for packaged mode BEFORE importing backend modules ---
if (app.isPackaged) {
  process.env.SCRCPY_JAR_PATH = path.join(process.resourcesPath, 'vendor', 'scrcpy-server.jar');
  process.env.NICKNAMES_PATH = path.join(app.getPath('userData'), 'nicknames.json');
  process.env.GROUPS_PATH = path.join(app.getPath('userData'), 'groups.json');
  // Warm-up state must live in userData (writable). Otherwise warmup-manager
  // tries to write into app.asar (read-only) and silently loses state.
  process.env.WARMUP_DATA_PATH = path.join(app.getPath('userData'), 'warmup');
}

// --- Import backend modules (desktop-host) ---
const { createHttpServer } = await import('../desktop-host/src/server/http-api.js');
const { wsServer } = await import('../desktop-host/src/server/ws-server.js');
const { deviceManager } = await import('../desktop-host/src/adb/device-manager.js');
const { sessionManager } = await import('../desktop-host/src/scrcpy/session-manager.js');
const { createLogger, setLogLevel } = await import('../desktop-host/src/utils/logger.js');

const log = createLogger('Electron');
const PORT = parseInt(process.env.PORT || '3001', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';

setLogLevel(LOG_LEVEL);

let mainWindow = null;
let httpServer = null;

function getIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(ROOT, 'Icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DroidConsole',
    icon: getIconPath(),
    show: false, // Hidden until splash finishes
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${PORT}/`);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startServer() {
  const expressApp = createHttpServer();
  const express = require('express');

  let distPath;
  if (app.isPackaged) {
    distPath = path.join(process.resourcesPath, 'web-frontend-dist');
  } else {
    distPath = path.join(ROOT, 'web-frontend', 'dist');
  }

  log.info('Serving frontend from', { path: distPath });
  expressApp.use(express.static(distPath));

  // SPA fallback for client-side routing (e.g. /share/:token)
  // Express 5 requires named wildcard params instead of bare *
  expressApp.get('{*path}', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });

  httpServer = createServer(expressApp);
  wsServer.start(httpServer);
  await deviceManager.start();

  return new Promise((resolve, reject) => {
    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        dialog.showErrorBox(
          'Port In Use',
          `Port ${PORT} is already in use. Please close the other application using this port and try again.`
        );
        app.quit();
      }
      reject(err);
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      log.info(`Server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

async function shutdown() {
  log.info('Shutting down...');
  deviceManager.stop();
  await sessionManager.stopAll();
  if (httpServer) httpServer.close();
}

// --- Splash Screen ---
function showSplash() {
  const iconPath = getIconPath().replace(/\\/g, '/');
  const splashPath = path.join(__dirname, 'splash.html');

  const splash = new BrowserWindow({
    width: 360,
    height: 340,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: getIconPath(),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splash.loadFile(splashPath, { query: { icon: iconPath } });
  return splash;
}

// --- Start everything (app is already ready from main.cjs) ---
let splash = null;
try {
  splash = showSplash();
  await startServer();
  createWindow();

  // When main window finishes loading, close splash and show main
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      if (splash && !splash.isDestroyed()) splash.close();
      if (mainWindow) mainWindow.show();
    }, 2000); // Show splash for at least 2 seconds
  });
} catch (err) {
  if (splash && !splash.isDestroyed()) splash.close();
  log.error('Failed to start', { error: err.message });
  dialog.showErrorBox('Startup Error', err.message);
  app.quit();
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  await shutdown();
});
