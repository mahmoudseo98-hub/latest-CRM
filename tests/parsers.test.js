'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAttendanceText, guessDelimiter } = require('../src/file-import');
const { parseHttpPush } = require('../src/http-push-parser');
const { detectDeviceVendor, isPrivateIPv4 } = require('../src/device-manager');

test('attendance import detects header CSV, ZKTeco tab text, and quoted CSV', () => {
  const header = parseAttendanceText('employeeId,date,time,verify,status\n1001,2026-08-24,09:30:00,0,1');
  assert.equal(header.records.length, 1);
  assert.equal(header.records[0].employeeId, '1001');

  const tab = parseAttendanceText('1002\t2026-08-24 10:00:00\t1\t0');
  assert.equal(tab.records.length, 1);
  assert.equal(tab.detected.delimiter, '\t');

  const quoted = parseAttendanceText('"employee","datetime","verify"\n"A-3","2026-08-24 11:00:00","2"');
  assert.equal(quoted.records[0].employeeId, 'A-3');
  assert.equal(guessDelimiter('a;b;c'), ';');
});

test('HTTP push parser accepts ADMS, generic ZKTeco, JSON, and form payloads', () => {
  const adms = parseHttpPush({ url: '/iclock/cdata', body: 'ATTLOG\t1001\t0\t2026-08-24 09:00:00\t1' });
  assert.equal(adms[0].employeeId, '1001');

  const generic = parseHttpPush({ url: '/iclock/cdata', body: '1002\t2026-08-24 09:05:00\t1\t0\t0' });
  assert.equal(generic[0].employeeId, '1002');

  const json = parseHttpPush({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: '1003', timestamp: '2026-08-24 09:10:00' }) });
  assert.equal(json[0].employeeId, '1003');

  const form = parseHttpPush({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'employeeId=1004&timestamp=2026-08-24T09%3A15%3A00Z' });
  assert.equal(form[0].employeeId, '1004');
});

test('device safety helpers identify vendors and private addresses', () => {
  assert.equal(detectDeviceVendor('<title>ZKTeco iClock</title>').vendor, 'ZKTeco');
  assert.equal(detectDeviceVendor('Suprema BioStar').vendor, 'Suprema');
  assert.equal(detectDeviceVendor('ordinary nginx landing page'), null);
  assert.equal(isPrivateIPv4('192.168.1.8'), true);
  assert.equal(isPrivateIPv4('172.20.1.2'), true);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
});
