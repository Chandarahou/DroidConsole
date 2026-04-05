import { randomBytes } from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ShareManager');

const MAX_DURATION_MINUTES = 30 * 24 * 60; // 30 days

export class ShareManager {
  constructor() {
    this.shares = new Map();
    this.cleanupTimer = setInterval(() => this._cleanup(), 60_000);
  }

  createShare(serials, options = {}) {
    const token = randomBytes(32).toString('hex');
    const expiresInMinutes = Math.min(options.expiresInMinutes || 60, MAX_DURATION_MINUTES);
    const permissions = options.permissions || { view: true, control: true };

    // Normalize: support both single serial (legacy) and array
    const serialList = Array.isArray(serials) ? serials : [serials];

    const name = options.name || '';

    const share = {
      token,
      name,
      serials: serialList,
      permissions,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresInMinutes * 60 * 1000,
      active: true,
    };

    this.shares.set(token, share);
    log.info('Share created', {
      name,
      devices: serialList.length,
      token: token.slice(0, 8) + '...',
      expiresInMinutes,
    });

    return {
      token,
      name,
      serials: serialList,
      permissions,
      expiresAt: share.expiresAt,
      shareUrl: `/share/${token}`,
    };
  }

  validateToken(token) {
    const share = this.shares.get(token);
    if (!share) return null;
    if (!share.active || Date.now() > share.expiresAt) {
      this.shares.delete(token);
      return null;
    }
    return share;
  }

  isSerialAllowed(token, serial) {
    const share = this.validateToken(token);
    if (!share) return false;
    return share.serials.includes(serial);
  }

  updateShareDevices(token, serials) {
    const share = this.shares.get(token);
    if (!share || !share.active) return null;
    share.serials = Array.isArray(serials) ? serials : [serials];
    log.info('Share updated', { token: token.slice(0, 8) + '...', devices: share.serials.length });
    return share;
  }

  revokeShare(token) {
    const share = this.shares.get(token);
    if (share) {
      share.active = false;
      this.shares.delete(token);
      log.info('Share revoked', { token: token.slice(0, 8) + '...' });
    }
  }

  getActiveShares() {
    const now = Date.now();
    return Array.from(this.shares.values())
      .filter(s => s.active && s.expiresAt > now)
      .map(s => ({
        token: s.token,
        name: s.name,
        serials: s.serials,
        permissions: s.permissions,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      }));
  }

  _cleanup() {
    const now = Date.now();
    for (const [token, share] of this.shares) {
      if (!share.active || now > share.expiresAt) {
        this.shares.delete(token);
      }
    }
  }

  stop() {
    clearInterval(this.cleanupTimer);
  }
}

export const shareManager = new ShareManager();
