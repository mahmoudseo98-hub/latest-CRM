'use strict';

function parseHttpPush({ body, headers = {}, url = '/' }) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body == null ? '' : body);
  const contentType = String(headers['content-type'] || '').toLowerCase();
  const path = String(url || '/').split('?')[0];

  if (/cdata|iclock/i.test(path) || /ATTLOG|OPERLOG/.test(text)) {
    return parseAdms(text);
  }
  if (contentType.includes('json') || /^[\s\r\n]*[\[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.map(normalizeObject).filter((row) => row && row.employeeId);
    } catch (_) { return []; }
  }
  try {
    const params = new URLSearchParams(text);
    const object = Object.fromEntries(params.entries());
    const row = normalizeObject(object);
    return row && row.employeeId ? [row] : [];
  } catch (_) { return []; }
}

function parseAdms(text) {
  const output = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts[0] === 'ATTLOG' && parts.length >= 5) {
      output.push({ employeeId: parts[1], verifyType: number(parts[2]), ts: timestamp(parts[3]), status: number(parts[4]), raw: line.slice(0, 2000) });
      continue;
    }
    // Common ZKTeco /iclock/cdata payload: user, datetime, status, verify, workcode...
    if (parts.length >= 2 && parts[0] !== 'OPERLOG') {
      const dateIndex = parts.findIndex((part, index) => index > 0 && parseDate(part));
      if (dateIndex > 0) {
        output.push({
          employeeId: String(parts[0]).trim(),
          ts: timestamp(parts[dateIndex]),
          status: number(parts[dateIndex + 1]),
          verifyType: number(parts[dateIndex + 2]),
          raw: line.slice(0, 2000),
        });
      }
    }
  }
  return output.filter((row) => row.employeeId);
}

function normalizeObject(row = {}) {
  const employeeId = row.employeeId || row.userId || row.user_id || row.enrollId || row.enroll_id || row.code || row.userid || row.pin;
  if (employeeId == null || String(employeeId).trim() === '') return null;
  return {
    employeeId: String(employeeId).trim().slice(0, 80),
    verifyType: number(row.verifyType || row.verify_type || row.verify || row.method),
    ts: timestamp(row.ts || row.timestamp || row.time || row.punchTime || row.datetime),
    status: number(row.status || row.state),
    raw: JSON.stringify(row).slice(0, 2000),
  };
}

function timestamp(value) {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : new Date().toISOString();
}

function parseDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const input = String(value).trim();
  if (/^\d{10}$/.test(input)) return new Date(Number(input) * 1000);
  if (/^\d{13}$/.test(input)) return new Date(Number(input));
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function number(value) {
  const output = Number(value);
  return Number.isFinite(output) ? output : 0;
}

module.exports = { parseHttpPush, parseAdms, normalizeObject, timestamp };
