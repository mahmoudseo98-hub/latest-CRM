'use strict';

const path = require('path');
const { readJson, writeJsonAtomic } = require('./storage');

class PeopleRegistry {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'people.json');
    const raw = readJson(this.file, { people: {} });
    this.people = raw && raw.people && typeof raw.people === 'object' ? raw.people : (raw || {});
  }

  persist() {
    writeJsonAtomic(this.file, { people: this.people });
  }

  lookup(employeeId) {
    const id = String(employeeId == null ? '' : employeeId).trim();
    return id ? this.people[id] || null : null;
  }

  register(employeeId, fields = {}) {
    const id = String(employeeId == null ? '' : employeeId).trim().slice(0, 80);
    const name = String(fields.name || '').trim().slice(0, 120);
    if (!id) throw new Error('Fingerprint ID is required.');
    if (!name) throw new Error('Name is required.');
    const previous = this.people[id] || {};
    const entry = {
      name,
      department: String(fields.department || previous.department || 'General').trim().slice(0, 120),
      deviceId: String(fields.deviceId || previous.deviceId || id).trim().slice(0, 80),
      createdAt: previous.createdAt || new Date().toISOString(),
      lastSeen: previous.lastSeen || null,
    };
    this.people[id] = entry;
    this.persist();
    return { employeeId: id, ...entry };
  }

  remove(employeeId) {
    const id = String(employeeId == null ? '' : employeeId).trim();
    if (!id || !this.people[id]) return false;
    delete this.people[id];
    this.persist();
    return true;
  }

  touch(employeeId, timestamp = new Date().toISOString()) {
    const person = this.lookup(employeeId);
    if (!person) return;
    person.lastSeen = timestamp;
    this.persist();
  }

  list() {
    return Object.entries(this.people)
      .map(([employeeId, person]) => ({ employeeId, ...person }))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  }

  export() {
    return { people: JSON.parse(JSON.stringify(this.people)) };
  }

  import(value) {
    const source = value && value.people && typeof value.people === 'object' ? value.people : {};
    this.people = source;
    this.persist();
    return this.list().length;
  }
}

module.exports = { PeopleRegistry };
