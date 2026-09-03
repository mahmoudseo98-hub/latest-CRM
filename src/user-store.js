'use strict';

const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./storage');

const SCRYPT_KEYLEN = 64;
// Cost parameters sized so a hash takes ~100ms on the deployment's single shared
// core: high enough to make offline guessing expensive, low enough that a sign-in
// does not stall the event loop noticeably.
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const BASE_ROLES = ['owner', 'admin', 'director', 'manager', 'lead', 'employee', 'client'];

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), useSalt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return { hash: derived.toString('hex'), salt: useSalt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  } catch (_) {
    return false;
  }
  const expected = Buffer.from(String(hash), 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function normalizeEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase().slice(0, 190);
}

function validEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : '';
}

// Deliberately modest: length does more for real-world safety than symbol classes,
// and heavy composition rules push people towards predictable substitutions.
function passwordProblem(password) {
  const value = String(password == null ? '' : password);
  if (value.length < 10) return 'Use at least 10 characters.';
  if (value.length > 200) return 'Password is too long.';
  if (/^\s|\s$/.test(value)) return 'Password cannot start or end with a space.';
  return '';
}

class UserStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'users.json');
    const raw = readJson(this.file, { users: [] });
    this.users = Array.isArray(raw && raw.users) ? raw.users : [];
  }

  persist() {
    writeJsonAtomic(this.file, { users: this.users });
  }

  count() {
    return this.users.length;
  }

  isBootstrapped() {
    return this.users.some((user) => user.baseRole === 'owner' && user.status === 'active');
  }

  findByEmail(email) {
    const target = normalizeEmail(email);
    if (!target) return null;
    return this.users.find((user) => user.email === target) || null;
  }

  findById(id) {
    const target = String(id == null ? '' : id);
    return this.users.find((user) => user.id === target) || null;
  }

  list() {
    return this.users.map((user) => this.publicView(user));
  }

  // Never let a hash, salt or token reach the client or an export.
  publicView(user) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      baseRole: user.baseRole,
      accessGroups: Array.isArray(user.accessGroups) ? user.accessGroups.slice() : [],
      status: user.status,
      forcePasswordChange: !!user.forcePasswordChange,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt || null,
    };
  }

  create({ email, displayName, password, baseRole = 'employee', accessGroups = [] }) {
    const cleanEmail = validEmail(email);
    if (!cleanEmail) throw badRequest('Enter a valid work email address.');
    if (this.findByEmail(cleanEmail)) throw badRequest('An account with that email already exists.');

    const name = String(displayName == null ? '' : displayName).trim().slice(0, 120);
    if (!name) throw badRequest('Enter a full name.');

    const problem = passwordProblem(password);
    if (problem) throw badRequest(problem);

    const role = BASE_ROLES.includes(baseRole) ? baseRole : 'employee';
    const { hash, salt } = hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      email: cleanEmail,
      displayName: name,
      passwordHash: hash,
      passwordSalt: salt,
      baseRole: role,
      accessGroups: Array.isArray(accessGroups) ? accessGroups.slice(0, 8) : [],
      status: 'active',
      forcePasswordChange: false,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    this.users.push(user);
    this.persist();
    return this.publicView(user);
  }

  // Returns the user record on success, or a reason code. The caller must not
  // reveal which of the two failed — that would confirm whether an email exists.
  authenticate(email, password) {
    const user = this.findByEmail(email);
    if (!user) {
      // Spend comparable time so a missing account is not detectably faster.
      hashPassword(String(password || ''), 'timing-equalizer-salt');
      return { ok: false, reason: 'invalid' };
    }
    if (user.status !== 'active') return { ok: false, reason: 'suspended' };
    if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, user };
  }

  markLogin(id) {
    const user = this.findById(id);
    if (!user) return null;
    user.lastLoginAt = new Date().toISOString();
    this.persist();
    return this.publicView(user);
  }

  setPassword(id, password) {
    const user = this.findById(id);
    if (!user) throw badRequest('Account not found.');
    const problem = passwordProblem(password);
    if (problem) throw badRequest(problem);
    const { hash, salt } = hashPassword(password);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.forcePasswordChange = false;
    user.updatedAt = new Date().toISOString();
    this.persist();
    return this.publicView(user);
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

module.exports = { UserStore, hashPassword, verifyPassword, passwordProblem, validEmail, normalizeEmail, BASE_ROLES };
