import { createServer } from 'node:http';
import { createHttpServer } from './server/http-api.js';
import { wsServer } from './server/ws-server.js';
import { deviceManager } from './adb/device-manager.js';
import { sessionManager } from './scrcpy/session-manager.js';
import { createLogger, setLogLevel } from './utils/logger.js';

const log = createLogger('Main');
const PORT = parseInt(process.env.PORT || '3001', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';

setLogLevel(LOG_LEVEL);

async function main() {
  log.info('Starting DroidConsole Desktop Host');

  // Create HTTP + WebSocket server
  const app = createHttpServer();
  const httpServer = createServer(app);

  // Attach WebSocket servers
  wsServer.start(httpServer);

  // Start device discovery polling
  await deviceManager.start();

  httpServer.listen(PORT, '0.0.0.0', () => {
    log.info(`Desktop Host running on http://localhost:${PORT}`);
    log.info('WebSocket endpoints:');
    log.info(`  Control: ws://localhost:${PORT}/ws/control`);
    log.info(`  Video:   ws://localhost:${PORT}/ws/video?serial=<device>`);
    log.info(`  Signal:  ws://localhost:${PORT}/ws/signaling`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    deviceManager.stop();
    await sessionManager.stopAll();
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
