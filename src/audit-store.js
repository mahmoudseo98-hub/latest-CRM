'use strict';

const path = require('path');
const { appendJsonLine, readJsonLines } = require('./storage');

class AuditStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'audit.jsonl');
  }

  log(action, target = '', detail = {}) {
    const row = {
      ts: new Date().toISOString(),
      action: String(action || 'unknown').slice(0, 120),
      target: String(target || '').slice(0, 500),
      detail: detail && typeof detail === 'object' ? detail : { value: String(detail) },
    };
    try { return appendJsonLine(this.file, row); } catch (_) { return row; }
  }

  read(limit = 200) {
    return readJsonLines(this.file, limit);
  }
}

module.exports = { AuditStore };
