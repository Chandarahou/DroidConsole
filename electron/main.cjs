// Ensure Electron runs as the full app framework, not as plain Node.js.
// VS Code and other Electron hosts set this, which would break child Electron apps.
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, dialog } = require('electron');

app.whenReady().then(async () => {
  try {
    await import('./app.js');
  } catch (err) {
    dialog.showErrorBox('Startup Error', err.message + '\n\n' + (err.stack || ''));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
