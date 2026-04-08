import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { adbClient } from '../adb/adb-client.js';
import { sessionManager } from '../scrcpy/session-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WarmUp');

// Warm-up phases and their daily action limits
const PHASES = {
  1: { name: 'Setup', days: 1, maxMessages: 0, maxContacts: 0, desc: 'Profile setup only' },
  2: { name: 'Light', days: 3, maxMessages: 5, maxContacts: 10, desc: '3-5 messages to friendly numbers' },
  3: { name: 'Moderate', days: 6, maxMessages: 15, maxContacts: 5, desc: '10-15 messages, join groups' },
  4: { name: 'Scaling', days: 10, maxMessages: 30, maxContacts: 5, desc: '20-30 messages, new contacts' },
  5: { name: 'Operational', days: -1, maxMessages: 100, maxContacts: 20, desc: 'Full volume' },
};

// Random message templates for warm-up
const MESSAGE_TEMPLATES = [
  'Hi, how are you?',
  'Hello! Hope you\'re doing well',
  'Hey, good morning!',
  'Hi there, nice to connect with you',
  'Hello, how\'s your day going?',
  'Hey! Just wanted to say hi',
  'Good day! How are things?',
  'Hi, hope everything is going great',
  'Hello! Nice weather today right?',
  'Hey, what\'s up?',
  'Hi! How have you been?',
  'Hello, just checking in',
  'Hey there! Have a great day',
  'Hi, hope you\'re having a good one',
  'Good afternoon! How are you?',
];

const DATA_DIR = process.env.WARMUP_DATA_PATH ||
  decodeURIComponent(new URL('../../data/warmup', import.meta.url).pathname)
    .replace(/^\/([A-Za-z]:)/, '$1');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function getDataFile() {
  return `${DATA_DIR}/warmup-state.json`;
}

export class WarmupManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map(); // serial -> warmup state
    this.running = new Map(); // serial -> interval timer
    this._load();
  }

  _load() {
    try {
      ensureDataDir();
      const file = getDataFile();
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        for (const [serial, state] of Object.entries(data)) {
          this.devices.set(serial, state);
        }
        log.info('Loaded warm-up state', { devices: this.devices.size });
      }
    } catch (err) {
      log.warn('Failed to load warm-up state', { error: err.message });
    }
  }

  _save() {
    try {
      ensureDataDir();
      const data = Object.fromEntries(this.devices);
      writeFileSync(getDataFile(), JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn('Failed to save warm-up state', { error: err.message });
    }
  }

  // Get or create warm-up state for a device
  getState(serial) {
    return this.devices.get(serial) || null;
  }

  getAllStates() {
    return Object.fromEntries(this.devices);
  }

  // Start warm-up for a device
  startWarmup(serial, contacts, options = {}) {
    const now = Date.now();
    const state = {
      serial,
      phase: 1,
      startedAt: now,
      dayNumber: 1,
      lastActionDate: null,
      contacts: contacts || [], // phone numbers to message
      messagesSentToday: 0,
      totalMessagesSent: 0,
      contactsAddedToday: 0,
      totalContactsAdded: 0,
      todayActions: [],
      log: [],
      paused: false,
      options: {
        delayMin: options.delayMin || 45,  // seconds between messages
        delayMax: options.delayMax || 120,
        randomizeText: options.randomizeText !== false,
        ...options,
      },
    };

    this.devices.set(serial, state);
    this._save();
    log.info('Warm-up started', { serial, contacts: contacts.length });
    this.emit('warmup:updated', serial, state);
    return state;
  }

  // Stop/remove warm-up
  stopWarmup(serial) {
    this.stopAutoRun(serial);
    this.devices.delete(serial);
    this._save();
    this.emit('warmup:updated', serial, null);
  }

  // Pause/resume
  togglePause(serial) {
    const state = this.devices.get(serial);
    if (!state) return null;
    state.paused = !state.paused;
    if (state.paused) this.stopAutoRun(serial);
    this._save();
    this.emit('warmup:updated', serial, state);
    return state;
  }

  // Update contacts list
  updateContacts(serial, contacts) {
    const state = this.devices.get(serial);
    if (!state) return null;
    state.contacts = contacts;
    this._save();
    return state;
  }

  // Calculate current phase based on day number
  _updatePhase(state) {
    let dayCount = 0;
    for (let p = 1; p <= 5; p++) {
      const phase = PHASES[p];
      if (phase.days === -1 || state.dayNumber <= dayCount + phase.days) {
        state.phase = p;
        return;
      }
      dayCount += phase.days;
    }
    state.phase = 5;
  }

  // Reset daily counters if new day
  _checkNewDay(state) {
    const today = new Date().toISOString().split('T')[0];
    if (state.lastActionDate !== today) {
      state.lastActionDate = today;
      state.messagesSentToday = 0;
      state.contactsAddedToday = 0;
      state.todayActions = [];
      // Increment day number
      if (state.lastActionDate) {
        const start = new Date(state.startedAt);
        const now = new Date();
        state.dayNumber = Math.floor((now - start) / 86400000) + 1;
      }
      this._updatePhase(state);
    }
  }

  // Execute a single warm-up action: send a message to a contact
  // opts.force = true bypasses daily phase limits (for manual sends)
  async executeAction(serial, opts = {}) {
    const state = this.devices.get(serial);
    if (!state || state.paused) return { success: false, error: 'Not active' };

    this._checkNewDay(state);
    const phase = PHASES[state.phase];

    // Check daily limits (skipped if force=true)
    if (!opts.force && state.messagesSentToday >= phase.maxMessages) {
      return { success: false, error: `Daily limit reached (${phase.maxMessages} messages)` };
    }

    // Pick a contact to message
    if (state.contacts.length === 0) {
      return { success: false, error: 'No contacts configured' };
    }

    const contactIndex = state.totalMessagesSent % state.contacts.length;
    const contact = state.contacts[contactIndex];

    // Pick a random message
    let message = opts.message
      || (state.options.testMessage)
      || MESSAGE_TEMPLATES[Math.floor(Math.random() * MESSAGE_TEMPLATES.length)];
    if (!opts.message && state.options.randomizeText && !state.options.testMessage) {
      const suffixes = ['', ' :)', '!', '.', '~', '..'];
      message += suffixes[Math.floor(Math.random() * suffixes.length)];
    }

    const session = sessionManager.getSession(serial);

    try {
      // Step 1: Open WhatsApp chat via DIRECT deep link with pre-filled text.
      // Using whatsapp://send (not https://api.whatsapp.com/send) avoids the
      // browser "Continue to chat" intermediate page. Pre-filling the text via
      // ?text= avoids relying on inject_text which WhatsApp partially blocks
      // (previously only "Hn" was making it through).
      const phoneOnly = contact.replace(/[^0-9]/g, '');
      const pkg = state.options.useBusiness ? 'com.whatsapp.w4b' : 'com.whatsapp';
      // URL-encode the message. encodeURIComponent does NOT escape "'" (it's
      // an RFC-3986 unreserved char), but we wrap the URL in single quotes for
      // adb shell, so any literal apostrophe (e.g. "how's") would break the
      // shell parser with "no closing quote". Force-encode it to %27.
      const encodedMsg = encodeURIComponent(message).replace(/'/g, '%27');
      const url = `whatsapp://send?phone=${phoneOnly}&text=${encodedMsg}`;
      await adbClient.shell(
        serial,
        `am start -a android.intent.action.VIEW -d '${url}' -p ${pkg}`
      );
      // Give WhatsApp time to open the chat and pre-fill the text field
      await sleep(4500);

      // Step 2: Tap the send button. We use the WhatsApp send button's
      // resource id via uiautomator if available, fallback to a tap on the
      // bottom-right area where the FAB lives. The most reliable cross-device
      // way is keyevent 66 (Enter) AFTER focusing the input by tapping it.
      // First tap the input box (rough bottom-center) to ensure focus, then
      // tap the send button (rough bottom-right) — coordinates as fractions
      // of typical 1080x2400 layouts.
      const info = await adbClient.shell(serial, 'wm size').catch(() => '');
      const m = /(\d+)x(\d+)/.exec(info || '');
      const w = m ? parseInt(m[1], 10) : 1080;
      const h = m ? parseInt(m[2], 10) : 2400;
      // Send button is roughly 95% width, 95% height
      const sx = Math.round(w * 0.94);
      const sy = Math.round(h * 0.945);
      await adbClient.shell(serial, `input tap ${sx} ${sy}`);
      await sleep(1500);

      // Step 3: Verify WhatsApp is still the focused app — if it isn't, the
      // chat never opened (deep link failed) or WhatsApp crashed, and the
      // tap above hit something else. Mark the action as failed instead of
      // logging a phantom "sent" entry.
      const focus = await adbClient.shell(serial, 'dumpsys window | grep mCurrentFocus').catch(() => '');
      if (!focus || !focus.includes(pkg)) {
        throw new Error(`Chat not open — focus was: ${focus.trim() || '(unknown)'}`);
      }

      // Step 4: Go back to chat list
      if (session && session.running) {
        session.injectKeyEvent(0, 4, 0, 0); // BACK
        session.injectKeyEvent(1, 4, 0, 0);
      } else {
        await adbClient.shell(serial, 'input keyevent 4');
      }

      // Update state
      state.messagesSentToday++;
      state.totalMessagesSent++;
      const actionLog = {
        time: Date.now(),
        type: 'message',
        contact,
        message,
        success: true,
      };
      state.todayActions.push(actionLog);
      state.log.push(actionLog);
      // Keep log manageable
      if (state.log.length > 500) state.log = state.log.slice(-300);

      this._save();
      this.emit('warmup:updated', serial, state);

      log.info('Warm-up message sent', { serial, contact, phase: state.phase, today: state.messagesSentToday });
      return { success: true, contact, message, todayCount: state.messagesSentToday };

    } catch (err) {
      const actionLog = { time: Date.now(), type: 'message', contact, message, success: false, error: err.message };
      state.todayActions.push(actionLog);
      this._save();
      log.error('Warm-up action failed', { serial, error: err.message });
      return { success: false, error: err.message };
    }
  }

  // Auto-run: periodically send messages with randomized delays
  startAutoRun(serial) {
    this.stopAutoRun(serial);
    const state = this.devices.get(serial);
    if (!state || state.paused) return false;

    const runNext = async () => {
      const st = this.devices.get(serial);
      if (!st || st.paused) { this.stopAutoRun(serial); return; }

      this._checkNewDay(st);
      const phase = PHASES[st.phase];

      if (st.messagesSentToday >= phase.maxMessages) {
        log.info('Daily limit reached, stopping auto-run', { serial, sent: st.messagesSentToday });
        this.stopAutoRun(serial);
        return;
      }

      await this.executeAction(serial);

      // Schedule next with random delay
      const delayMs = (st.options.delayMin + Math.random() * (st.options.delayMax - st.options.delayMin)) * 1000;
      const timer = setTimeout(runNext, delayMs);
      this.running.set(serial, timer);
    };

    // Start first action after a short delay
    const timer = setTimeout(runNext, 2000);
    this.running.set(serial, timer);
    log.info('Auto-run started', { serial });
    return true;
  }

  stopAutoRun(serial) {
    const timer = this.running.get(serial);
    if (timer) {
      clearTimeout(timer);
      this.running.delete(serial);
      log.info('Auto-run stopped', { serial });
    }
  }

  isAutoRunning(serial) {
    return this.running.has(serial);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export const warmupManager = new WarmupManager();
