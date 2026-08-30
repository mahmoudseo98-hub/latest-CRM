'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, readJson, writeJsonAtomic, safeName, removeIfExists } = require('./storage');

class ProjectStore {
  constructor(dataDir) {
    this.dir = ensureDir(path.join(dataDir, 'projects'));
  }

  fileFor(name) {
    return path.join(this.dir, `${safeName(name, 'project')}.json`);
  }

  save(name, data) {
    const cleanName = String(name || '').trim().slice(0, 160);
    if (!cleanName) throw new Error('Project name is required.');
    const record = { name: cleanName, savedAt: new Date().toISOString(), data };
    writeJsonAtomic(this.fileFor(cleanName), record);
    return { name: record.name, savedAt: record.savedAt, size: fs.statSync(this.fileFor(cleanName)).size };
  }

  list() {
    return fs.readdirSync(this.dir)
      .filter((filename) => filename.endsWith('.json'))
      .map((filename) => {
        const file = path.join(this.dir, filename);
        const record = readJson(file, null);
        if (!record) return null;
        return { name: record.name || filename.replace(/\.json$/, ''), file: filename, savedAt: record.savedAt || null, size: fs.statSync(file).size };
      })
      .filter(Boolean)
      .sort((left, right) => String(right.savedAt || '').localeCompare(String(left.savedAt || '')));
  }

  load(name) {
    const file = this.fileFor(name);
    if (!fs.existsSync(file)) throw new Error(`Project not found: ${name}`);
    const value = readJson(file, null);
    if (!value) throw new Error(`Project is corrupt: ${name}`);
    return value;
  }

  remove(name) {
    return removeIfExists(this.fileFor(name));
  }

  export() {
    return this.list().map((item) => this.load(item.name));
  }

  import(records) {
    let count = 0;
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || !record.name) continue;
      this.save(record.name, record.data);
      count += 1;
    }
    return count;
  }
}

module.exports = { ProjectStore };
