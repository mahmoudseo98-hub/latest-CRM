'use strict';

function guessDelimiter(line) {
  const tabs = (String(line).match(/\t/g) || []).length;
  const commas = (String(line).match(/,/g) || []).length;
  const semicolons = (String(line).match(/;/g) || []).length;
  if (tabs >= commas && tabs >= semicolons && tabs > 0) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

function parseDateCell(value) {
  if (value == null) return null;
  const input = String(value).trim();
  if (!input) return null;
  if (/^\d{10}$/.test(input)) return validDate(new Date(Number(input) * 1000));
  if (/^\d{13}$/.test(input)) return validDate(new Date(Number(input)));
  const native = validDate(new Date(input));
  if (native) return native;
  return validDate(new Date(input.replace(/-/g, '/')));
}

function validDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

function autoMap(headers) {
  const normalized = headers.map((header) => String(header || '').toLowerCase());
  const find = (needles) => {
    for (const needle of needles) {
      const index = normalized.findIndex((header) => header.includes(needle));
      if (index >= 0) return index;
    }
    return -1;
  };
  return {
    employeeId: find(['enroll', 'user', 'employee', 'badge', 'code', 'emp']),
    ts: find(['timestamp', 'datetime', 'punch time', 'date time']),
    date: find(['date']),
    time: find(['time']),
    verify: find(['verify', 'type', 'method']),
    status: find(['status', 'state']),
  };
}

const CANDIDATE_PROFILES = [
  { employeeId: 0, ts: 1, date: -1, time: -1, verify: 2, status: 3 },
  { employeeId: 0, ts: -1, date: 1, time: 2, verify: 3, status: 4 },
  { employeeId: 0, ts: 1, date: -1, time: -1, verify: 2, status: -1 },
  { employeeId: 0, ts: -1, date: 1, time: 2, verify: 3, status: -1 },
];

function dateFromRow(row, map) {
  if (map.ts >= 0) {
    const direct = parseDateCell(row[map.ts]);
    if (direct) return direct;
  }
  const date = map.date >= 0 ? row[map.date] : '';
  const time = map.time >= 0 ? row[map.time] : '';
  return parseDateCell(`${date || ''}${date && time ? ' ' : ''}${time || ''}`);
}

function parseRows(rows, start, map) {
  const records = [];
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    const employee = map.employeeId >= 0 ? String(row[map.employeeId] || '').trim() : '';
    if (!employee) continue;
    const date = dateFromRow(row, map);
    if (!date) continue;
    records.push({
      employeeId: employee.slice(0, 80),
      ts: date.toISOString(),
      verifyType: map.verify >= 0 ? Number(row[map.verify]) || 0 : 0,
      status: map.status >= 0 ? Number(row[map.status]) || 0 : 0,
      raw: row.join('\t').slice(0, 2000),
    });
  }
  return records;
}

function parseAttendanceText(text, profile) {
  const input = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  if (Buffer.byteLength(input, 'utf8') > 10 * 1024 * 1024) throw new Error('Attendance file is larger than 10 MB.');
  const lines = input.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { records: [], detected: { delimiter: ',', headerIdx: -1, map: null, profile: 'empty' } };
  const delimiter = guessDelimiter(lines[0]);
  const rows = lines.map((line) => splitRow(line, delimiter));
  let headerIdx = -1;
  for (let index = 0; index < Math.min(5, rows.length); index += 1) {
    if (/enroll|user id|employee|badge|timestamp|datetime|verify|status/i.test(rows[index].join(' ')) && rows[index].length >= 2) {
      headerIdx = index;
      break;
    }
  }
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;
  let best = { records: [], map: null, profileName: 'none' };
  if (profile && profile.map) {
    best = { records: parseRows(rows, start, profile.map), map: profile.map, profileName: 'custom' };
  } else {
    if (headerIdx >= 0) {
      const map = autoMap(rows[headerIdx]);
      best = { records: parseRows(rows, start, map), map, profileName: 'header' };
    }
    CANDIDATE_PROFILES.forEach((map, index) => {
      const records = parseRows(rows, start, map);
      if (records.length > best.records.length) best = { records, map, profileName: `auto-${index}` };
    });
  }
  return { records: best.records, detected: { delimiter, headerIdx, map: best.map, profile: best.profileName } };
}

function splitRow(line, delimiter) {
  if (delimiter === '\t') return line.split('\t').map(cleanCell);
  const output = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      output.push(cleanCell(value));
      value = '';
    } else value += char;
  }
  output.push(cleanCell(value));
  return output;
}

function cleanCell(value) {
  return String(value == null ? '' : value).trim().replace(/^"|"$/g, '');
}

module.exports = { parseAttendanceText, parseDateCell, autoMap, guessDelimiter, splitRow };
