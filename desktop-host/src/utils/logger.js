const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLevel = LEVELS.INFO;

function timestamp() {
  return new Date().toISOString();
}

function format(level, module, msg, data) {
  const base = `[${timestamp()}] [${level}] [${module}] ${msg}`;
  return data !== undefined ? `${base} ${JSON.stringify(data)}` : base;
}

export function setLogLevel(level) {
  currentLevel = LEVELS[level] ?? LEVELS.INFO;
}

export function createLogger(module) {
  return {
    debug(msg, data) {
      if (currentLevel <= LEVELS.DEBUG) console.debug(format('DEBUG', module, msg, data));
    },
    info(msg, data) {
      if (currentLevel <= LEVELS.INFO) console.log(format('INFO', module, msg, data));
    },
    warn(msg, data) {
      if (currentLevel <= LEVELS.WARN) console.warn(format('WARN', module, msg, data));
    },
    error(msg, data) {
      if (currentLevel <= LEVELS.ERROR) console.error(format('ERROR', module, msg, data));
    },
  };
}
