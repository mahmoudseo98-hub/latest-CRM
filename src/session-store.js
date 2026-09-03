'use strict';

const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./storage');

const IDLE_MS = 12 * 60 * 60 * 1000;        // signed out after 12h of inactivity
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // and after 7 days regardless
const REMEMBER_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

// The raw token only ever exists in the user's cookie. What is stored here is a
// SHA-256 of it, so a leaked data directory does not hand over live sessions.
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

class SessionStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'sessions.json');
    const raw = readJson(this.file, { sessions: [] });
    this.sessions = Array.isArray(raw && raw.sessions) ? raw.sessions : [];
    this.prune();
  }

  persist() {
    writeJsonAtomic(this.file, { sessions: this.sessions });
  }

  prune() {
    const now = Date.now();
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => {
      const idleOk = now - new Date(s.lastSeenAt).getTime() < IDLE_MS;
      const absoluteOk = now < new Date(s.absoluteExpiresAt).getTime();
      return idleOk && absoluteOk;
    });
    if (this.sessions.length !== before) this.persist();
    return before - this.sessions.length;
  }

  create(userId, { remember = false, userAgent = '' } = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const now = new Date();
    const absolute = new Date(now.getTime() + (remember ? REMEMBER_ABSOLUTE_MS : ABSOLUTE_MS));
    this.sessions.push({
      tokenHash: hashToken(token),
      csrf,
      userId: String(userId),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      absoluteExpiresAt: absolute.toISOString(),
      userAgent: String(userAgent || '').slice(0, 200),
    });
    this.persist();
    return { token, csrf, expiresAt: absolute.toISOString() };
  }

  // Returns the session record and slides the idle window forward.
  touch(token) {
    if (!token) return null;
    const wanted = hashToken(token);
    const record = this.sessions.find((s) => s.tokenHash === wanted);
    if (!record) return null;

    const now = Date.now();
    if (now - new Date(record.lastSeenAt).getTime() >= IDLE_MS) { this.destroy(token); return null; }
    if (now >= new Date(record.absoluteExpiresAt).getTime()) { this.destroy(token); return null; }

    // Only write on a meaningful move so a busy tab does not rewrite the file
    // on every request.
    if (now - new Date(record.lastSeenAt).getTime() > 60 * 1000) {
      record.lastSeenAt = new Date(now).toISOString();
      this.persist();
    }
    return record;
  }

  destroy(token) {
    if (!token) return false;
    const wanted = hashToken(token);
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.tokenHash !== wanted);
    if (this.sessions.length !== before) { this.persist(); return true; }
    return false;
  }

  // Used when a password changes or an account is suspended: every existing
  // session for that user stops working immediately.
  destroyAllForUser(userId) {
    const target = String(userId);
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.userId !== target);
    const removed = before - this.sessions.length;
    if (removed) this.persist();
    return removed;
  }
}

module.exports = { SessionStore, IDLE_MS, ABSOLUTE_MS, REMEMBER_ABSOLUTE_MS };
