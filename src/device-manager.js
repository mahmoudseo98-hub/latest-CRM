'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const { readJson, writeJsonAtomic, appendJsonLine, readJsonLines, ensureDir } = require('./storage');
const { parseAttendanceText } = require('./file-import');
const { parseHttpPush } = require('./http-push-parser');
const { ZKClient } = require('./device/zk-protocol');

const TYPES = new Set(['http-push', 'zk-tcp', 'keyboard-wedge', 'simulator']);
const SIMULATOR_POOL = ['1001', '1002', '1003', '1004', '1005', '2001', '2002', '3001'];

class DeviceManager extends EventEmitter {
  constructor({ dataDir, audit, people, company, allowLan = false }) {
    super();
    this.dataDir = dataDir;
    this.audit = audit;
    this.people = people;
    this.company = company;
    this.allowLan = Boolean(allowLan);
    this.devicesFile = path.join(dataDir, 'devices.json');
    this.punchesFile = path.join(dataDir, 'punches.jsonl');
    this.devices = readJson(this.devicesFile, []);
    if (!Array.isArray(this.devices)) this.devices = [];
    this.instances = new Map();
    ensureDir(path.dirname(this.punchesFile));
  }

  init() {
    for (const device of this.devices) {
      if (device.enabled !== false) this.start(device.id).catch(() => {});
    }
    return this;
  }

  persist() {
    writeJsonAtomic(this.devicesFile, this.devices);
  }

  list() {
    return this.devices.map((device) => {
      const instance = this.instances.get(device.id);
      return {
        id: device.id,
        name: device.name,
        type: device.type,
        enabled: device.enabled !== false,
        config: publicConfig(device.config),
        createdAt: device.createdAt,
        status: instance ? instance.status : 'stopped',
        lastError: instance ? instance.lastError : null,
        lastEvent: instance ? instance.lastEvent : null,
        lastPollAt: instance ? instance.lastPollAt : null,
      };
    });
  }

  get(id) {
    return this.devices.find((device) => device.id === id) || null;
  }

  add(input = {}) {
    const type = String(input.type || '').trim();
    if (!TYPES.has(type)) throw new Error(`Unknown connector type: ${type}`);
    const config = cleanConfig(type, input.config || {});
    const device = {
      id: `dev_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      name: String(input.name || type).trim().slice(0, 120),
      type,
      config,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    this.devices.push(device);
    this.persist();
    this.audit.log('device.add', device.id, { name: device.name, type: device.type, config: auditConfig(config) });
    return this.list().find((item) => item.id === device.id);
  }

  async remove(id) {
    await this.stop(id);
    const before = this.devices.length;
    this.devices = this.devices.filter((device) => device.id !== id);
    if (this.devices.length === before) return false;
    this.persist();
    this.audit.log('device.remove', id, {});
    return true;
  }

  async start(id) {
    const device = this.get(id);
    if (!device) throw new Error('Device not found.');
    await this.stop(id);
    const instance = { status: 'starting', lastError: null, lastEvent: null, lastPollAt: null, timer: null, client: null };
    this.instances.set(id, instance);
    device.enabled = true;
    this.persist();
    try {
      let result = { ok: true };
      if (device.type === 'simulator') result = this.startSimulator(device, instance);
      if (device.type === 'zk-tcp') {
        this.requireLan();
        await this.pollZk(device, instance);
        const interval = Math.max(5, Number(device.config.pollIntervalSec || 15)) * 1000;
        instance.timer = setInterval(() => this.pollZk(device, instance).catch((error) => this.connectorError(device, instance, error)), interval);
      }
      if (device.type === 'http-push') result = { ok: true, note: 'HTTP push endpoint is active on the main web server.' };
      if (device.type === 'keyboard-wedge') result = { ok: true, note: 'USB keyboard-wedge capture is armed while the Devices page is focused.' };
      instance.status = 'running';
      this.audit.log('device.start', id, { type: device.type });
      return result;
    } catch (error) {
      instance.status = 'error';
      instance.lastError = friendlyNetworkError(error, device.config);
      this.audit.log('device.start-failed', id, { error: instance.lastError });
      throw new Error(instance.lastError);
    }
  }

  async stop(id) {
    const instance = this.instances.get(id);
    if (!instance) return { ok: true };
    if (instance.timer) clearInterval(instance.timer);
    if (instance.client) {
      try { instance.client.disconnect(); } catch (_) {}
    }
    this.instances.delete(id);
    return { ok: true };
  }

  async test(id) {
    const device = this.get(id);
    if (!device) throw new Error('Device not found.');
    let result;
    if (device.type === 'zk-tcp') {
      this.requireLan();
      validatePrivateHost(device.config.host);
      const client = new ZKClient({
        host: device.config.host,
        port: Number(device.config.port || 4370),
        password: Number(device.config.password || 0),
        timeoutMs: 4500,
      });
      try {
        await client.connect();
        const time = await client.getTime();
        result = { ok: true, deviceTime: time.iso };
      } catch (error) {
        throw new Error(friendlyNetworkError(error, device.config));
      } finally {
        try { client.disconnect(); } catch (_) {}
      }
    } else if (device.type === 'http-push') {
      result = { ok: true, note: 'Receiver is available through this website’s device-push endpoint.' };
    } else if (device.type === 'keyboard-wedge') {
      result = { ok: true, note: 'No handshake is required. Start it, focus the Devices page, then scan.' };
    } else {
      result = { ok: true, note: 'Simulator is ready.' };
    }
    this.audit.log('device.test', id, result);
    return result;
  }

  startSimulator(device, instance) {
    if (device.config.mode !== 'manual') {
      const interval = Math.max(2, Number(device.config.intervalSec || 8)) * 1000;
      instance.timer = setInterval(() => this.simulatorPunch(device), interval);
    }
    return { ok: true };
  }

  simulatorPunch(device, employeeId, secondsAgo = 0) {
    const pool = Array.isArray(device.config.pool) && device.config.pool.length ? device.config.pool : SIMULATOR_POOL;
    const id = employeeId || pool[Math.floor(Math.random() * pool.length)];
    const punch = {
      employeeId: String(id),
      ts: new Date(Date.now() - Math.max(0, Number(secondsAgo) || 0) * 1000).toISOString(),
      verifyType: Math.floor(Math.random() * 3),
      status: 1,
      raw: `sim:${id}`,
    };
    this.onPunch(device, punch);
    return punch;
  }

  simulatePunch(employeeId, secondsAgo = 0) {
    const device = this.devices.find((item) => item.type === 'simulator') || {
      id: 'adhoc-sim',
      name: 'Ad-hoc Simulator',
      type: 'simulator',
      config: { mode: 'manual' },
    };
    return this.simulatorPunch(device, employeeId, secondsAgo);
  }

  wedgePunch(id, employeeId) {
    const device = id ? this.get(id) : this.devices.find((item) => item.type === 'keyboard-wedge' && this.instances.get(item.id)?.status === 'running');
    if (!device || device.type !== 'keyboard-wedge') throw new Error('No running keyboard-wedge device is armed.');
    const instance = this.instances.get(device.id);
    if (!instance || instance.status !== 'running') throw new Error('Start the keyboard-wedge device first.');
    const cleanId = String(employeeId || '').trim().slice(0, Number(device.config.maxLen || 24));
    if (cleanId.length < Number(device.config.minLen || 1)) throw new Error('Scanned ID is too short.');
    const punch = { employeeId: cleanId, ts: new Date().toISOString(), verifyType: 0, status: 1, raw: `wedge:${cleanId}` };
    this.onPunch(device, punch);
    return punch;
  }

  importText(filename, text, profile) {
    const { records, detected } = parseAttendanceText(text, profile);
    const device = { id: 'file-import', name: `File Import · ${String(filename || 'attendance file').slice(0, 100)}`, type: 'file-import' };
    records.forEach((record) => this.onPunch(device, record));
    this.audit.log('device.importFile', String(filename || 'attendance file'), { records: records.length, detected });
    return { imported: records.length, detected };
  }

  receiveHttpPush(deviceId, requestData) {
    const candidates = this.devices.filter((item) => item.type === 'http-push');
    const device = deviceId ? candidates.find((item) => item.id === deviceId) : candidates[0];
    if (!device) throw Object.assign(new Error('HTTP push device is not configured.'), { statusCode: 404 });
    const expected = String(device.config.token || '');
    const supplied = pushToken(requestData);
    if (expected && !safeEqual(expected, supplied)) throw Object.assign(new Error('Invalid device token.'), { statusCode: 401 });
    const records = parseHttpPush(requestData);
    records.forEach((record) => this.onPunch(device, record));
    this.audit.log('device.http-push.receive', device.id, { records: records.length });
    return { accepted: records.length };
  }

  onPunch(device, punch) {
    if (!punch || !punch.employeeId) return null;
    const person = this.people.lookup(punch.employeeId);
    const timestamp = punch.ts || new Date().toISOString();
    if (person) this.people.touch(punch.employeeId, timestamp);
    const normalized = {
      deviceId: device.id,
      deviceName: device.name,
      connector: device.type,
      employeeId: String(punch.employeeId).slice(0, 80),
      name: person ? person.name : null,
      department: person ? person.department : null,
      registered: Boolean(person),
      ts: timestamp,
      verifyType: Number(punch.verifyType) || 0,
      status: Number(punch.status) || 0,
      raw: String(punch.raw || '').slice(0, 2000),
    };
    appendJsonLine(this.punchesFile, normalized);
    this.audit.log('device.punch', device.id, { employeeId: normalized.employeeId, name: normalized.name, ts: normalized.ts });
    const instance = this.instances.get(device.id);
    if (instance) instance.lastEvent = normalized;
    this.emit('event', { kind: 'punch', ...normalized });
    return normalized;
  }

  punches(limit = 200) {
    return readJsonLines(this.punchesFile, limit);
  }

  registerPerson(employeeId, fields) {
    const person = this.people.register(employeeId, fields);
    if (this.company) this.company.upsertEmployee({ ...person, deviceId: person.employeeId, role: 'employee' });
    this.audit.log('people.register', person.employeeId, { name: person.name, department: person.department });
    return person;
  }

  removePerson(employeeId) {
    const removed = this.people.remove(employeeId);
    if (removed) this.audit.log('people.remove', String(employeeId), {});
    return removed;
  }

  async pollZk(device, instance) {
    validatePrivateHost(device.config.host);
    const client = new ZKClient({
      host: device.config.host,
      port: Number(device.config.port || 4370),
      password: Number(device.config.password || 0),
      timeoutMs: 4500,
    });
    instance.client = client;
    try {
      await client.connect();
      await client.disableDevice().catch(() => null);
      const records = await client.readAttendance();
      await client.enableDevice().catch(() => null);
      instance.lastPollAt = new Date().toISOString();
      instance.lastError = null;
      instance.status = 'running';
      instance.seen = instance.seen || new Set();
      let pushed = 0;
      for (const record of records) {
        const key = `${record.userId}|${record.ts}`;
        if (instance.seen.has(key)) continue;
        instance.seen.add(key);
        if (instance.seen.size > 50000) instance.seen.clear();
        this.onPunch(device, { employeeId: record.userId, ts: record.date, verifyType: record.verifyType, status: record.status, raw: JSON.stringify(record) });
        pushed += 1;
      }
      if (pushed) this.audit.log('device.zk-tcp.poll', device.id, { records: pushed });
    } finally {
      try { client.disconnect(); } catch (_) {}
      instance.client = null;
    }
  }

  connectorError(device, instance, error) {
    instance.status = 'error';
    instance.lastError = friendlyNetworkError(error, device.config);
    this.audit.log('device.zk-tcp.error', device.id, { error: instance.lastError });
  }

  requireLan() {
    if (!this.allowLan) {
      const error = new Error('LAN device access is disabled on this server. Set ENABLE_LAN_DEVICE_ACCESS=true only when Node.js runs on the same private network as the terminal.');
      error.statusCode = 409;
      throw error;
    }
  }

  async scanNetwork() {
    this.requireLan();
    const hosts = enumerateLanHosts();
    if (!hosts.length) return [];
    const ports = [4370, 80, 8080, 8090];
    const open = new Map();
    await runPool(hosts.flatMap((host) => ports.map((port) => ({ host, port }))), 80, async ({ host, port }) => {
      if (await probePort(host, port, 300)) {
        if (!open.has(host)) open.set(host, new Set());
        open.get(host).add(port);
      }
    });
    const found = [];
    for (const [host, hostPorts] of open.entries()) {
      if (hostPorts.has(4370)) {
        const device = await probeZk(host, 4370);
        if (device) { found.push({ ip: host, port: 4370, type: 'zk-tcp', ...device }); continue; }
      }
      for (const port of [80, 8080, 8090]) {
        if (!hostPorts.has(port)) continue;
        const device = await probeHttpDevice(host, port);
        if (device) { found.push({ ip: host, port, type: 'http-push', ...device }); break; }
      }
    }
    this.audit.log('device.scan', 'private-lan', { hosts: hosts.length, found: found.map((item) => `${item.ip}:${item.port}:${item.type}`) });
    return found;
  }

  async shutdown() {
    await Promise.all([...this.instances.keys()].map((id) => this.stop(id)));
  }
}

function cleanConfig(type, input) {
  if (type === 'http-push') return { token: String(input.token || '').trim().slice(0, 200) };
  if (type === 'zk-tcp') return {
    host: String(input.host || '').trim().slice(0, 255),
    port: clamp(input.port, 1, 65535, 4370),
    password: clamp(input.password, 0, 99999999, 0),
    pollIntervalSec: clamp(input.pollIntervalSec, 5, 3600, 15),
  };
  if (type === 'keyboard-wedge') return {
    prefix: String(input.prefix || '').slice(0, 20),
    minLen: clamp(input.minLen, 1, 80, 1),
    maxLen: clamp(input.maxLen, 1, 80, 24),
  };
  return {
    mode: input.mode === 'manual' ? 'manual' : 'auto',
    intervalSec: clamp(input.intervalSec, 2, 3600, 8),
    pool: Array.isArray(input.pool) ? input.pool.map(String).slice(0, 200) : undefined,
  };
}

function publicConfig(config = {}) {
  const output = { ...config };
  if (output.token) output.token = '••••••••';
  if (output.password) output.password = '••••';
  return output;
}

function auditConfig(config = {}) {
  const output = { ...config };
  if ('token' in output) output.token = output.token ? '[configured]' : '';
  if ('password' in output) output.password = output.password ? '[configured]' : 0;
  return output;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function pushToken(requestData) {
  const headers = requestData.headers || {};
  const direct = headers['x-token'] || headers.authorization || '';
  if (direct) return String(direct).replace(/^Bearer\s+/i, '');
  try { return new URL(requestData.url || '/', 'http://localhost').searchParams.get('token') || ''; } catch (_) { return ''; }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function friendlyNetworkError(error, config = {}) {
  const code = error && error.code;
  const host = config.host || 'the device';
  const port = config.port || 4370;
  const hints = {
    ECONNREFUSED: `Nothing is listening on ${host}:${port}. Check the device IP, TCP port, and firewall.`,
    ECONNRESET: `${host} closed the ZKTeco handshake. The terminal may use ADMS/HTTP push instead of TCP 4370.`,
    ETIMEDOUT: `Timed out reaching ${host}. Confirm that the Node.js server and terminal are on the same private LAN.`,
    EHOSTUNREACH: `${host} is unreachable from the Node.js server.`,
    ENETUNREACH: `The private network for ${host} is unreachable from the Node.js server.`,
  };
  return hints[code] || String(error && error.message || error || 'Device connection failed.');
}

function validatePrivateHost(host) {
  if (!isPrivateIPv4(host)) throw new Error('For safety, ZK TCP device hosts must be private IPv4 addresses (10.x, 172.16–31.x, or 192.168.x).');
}

function isPrivateIPv4(host) {
  if (net.isIP(host) !== 4) return false;
  const parts = host.split('.').map(Number);
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function enumerateLanHosts() {
  const subnets = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal || !isPrivateIPv4(item.address)) continue;
      const parts = item.address.split('.');
      subnets.add(parts.slice(0, 3).join('.'));
    }
  }
  const hosts = [];
  for (const subnet of subnets) for (let suffix = 1; suffix <= 254; suffix += 1) hosts.push(`${subnet}.${suffix}`);
  return hosts;
}

function probePort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
    socket.connect(port, host);
  });
}

async function runPool(items, concurrency, task) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
}

async function probeZk(host, port) {
  const client = new ZKClient({ host, port, password: 0, timeoutMs: 2200 });
  try {
    await client.connect();
    let deviceTime = null;
    try { deviceTime = (await client.getTime()).iso; } catch (_) {}
    return { vendor: 'ZKTeco', model: 'ZKTeco-class terminal', deviceTime };
  } catch (_) { return null; }
  finally { try { client.disconnect(); } catch (_) {} }
}

function probeHttpDevice(host, port) {
  return new Promise((resolve) => {
    const request = http.request({ host, port, path: '/', method: 'GET', timeout: 1800, headers: { 'User-Agent': 'SEO-For-All-OS/1.0' } }, (response) => {
      let body = '';
      response.on('data', (chunk) => { if (body.length < 8000) body += chunk.toString('utf8'); });
      response.on('end', () => {
        const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
        const match = detectDeviceVendor(`${body} ${response.headers.server || ''} ${title}`);
        resolve(match ? { ...match, title: title.trim().slice(0, 60) } : null);
      });
    });
    request.once('error', () => resolve(null));
    request.once('timeout', () => { request.destroy(); resolve(null); });
    request.end();
  });
}

function detectDeviceVendor(value) {
  const input = String(value || '').toLowerCase();
  const signatures = [
    { pattern: /zkteco|zkt ?eco|iclock|adms|bioclock|inbio|attmachine|zkaccess/i, vendor: 'ZKTeco', model: 'ZKTeco web / ADMS' },
    { pattern: /suprema|biostar|facestation|biolite/i, vendor: 'Suprema', model: 'Suprema BioStar' },
    { pattern: /anviz|crosschex|tc550|tc780/i, vendor: 'Anviz', model: 'Anviz CrossChex' },
    { pattern: /fingerprint|attendance|time ?clock|biometric|punch/i, vendor: 'Time-clock', model: 'web UI' },
  ];
  const match = signatures.find((item) => item.pattern.test(input));
  return match ? { vendor: match.vendor, model: match.model } : null;
}

module.exports = {
  DeviceManager,
  detectDeviceVendor,
  isPrivateIPv4,
  cleanConfig,
  friendlyNetworkError,
  TYPES,
};
