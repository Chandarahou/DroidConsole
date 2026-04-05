// Shared constants between Desktop Host and Web Frontend

export const WS_PORTS = {
  CONTROL: 8080,
  VIDEO: 8081,
  SIGNALING: 8082,
};

export const HTTP_PORT = 3001;

export const DEVICE_STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  UNAUTHORIZED: 'unauthorized',
  MIRRORING: 'mirroring',
  ERROR: 'error',
};

export const BATCH_ACTIONS = {
  INSTALL_APK: 'install_apk',
  CLEAR_DATA: 'clear_data',
  REBOOT: 'reboot',
  SCREENSHOT: 'screenshot',
  SHELL_COMMAND: 'shell_command',
};

export const INPUT_EVENTS = {
  MOUSE_DOWN: 'mouse_down',
  MOUSE_UP: 'mouse_up',
  MOUSE_MOVE: 'mouse_move',
  KEY_DOWN: 'key_down',
  KEY_UP: 'key_up',
  SCROLL: 'scroll',
  SWIPE: 'swipe',
  TEXT: 'text',
};

export const SCRCPY_DEFAULTS = {
  MAX_SIZE: 1024,
  BIT_RATE: 4_000_000,
  MAX_FPS: 30,
  LOCK_VIDEO_ORIENTATION: -1,
  ENCODER_NAME: '',
};
