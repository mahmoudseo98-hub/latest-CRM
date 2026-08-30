'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApplication } = require('../src/app');

function startApplication(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-for-all-node-test-'));
  const application = createApplication({ projectRoot: path.join(__dirname, '..'), dataDir, ...options });
  const server = http.createServer(application.handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        application,
        server,
        dataDir,
        origin: `http://127.0.0.1:${address.port}`,
        close: async () => {
          await new Promise((done) => server.close(done));
          await application.close();
          fs.rmSync(dataDir, { recursive: true, force: true });
        },
      });
    });
  });
}

async function api(origin, pathname, options = {}) {
  const init = { redirect: 'manual', ...options, headers: { ...(options.headers || {}) } };
  if (init.body && typeof init.body !== 'string') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  if (init.method && !['GET', 'HEAD'].includes(init.method)) init.headers['X-SEO-Requested-With'] = 'web';
  const response = await fetch(origin + pathname, init);
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  return { response, value };
}

test('complete server workflow persists company, projects, people, devices, punches, imports, and backup', async () => {
  const app = await startApplication();
  try {
    const root = await api(app.origin, '/');
    assert.equal(root.response.status, 302);
    assert.equal(root.response.headers.get('location'), '/setup.html');

    const setupPage = await api(app.origin, '/setup.html');
    assert.equal(setupPage.response.status, 200);
    assert.match(setupPage.value, /STEP 1 \/ 7/);

    const company = await api(app.origin, '/api/company', {
      method: 'PUT',
      body: {
        companyName: 'QA Company',
        tagline: 'Company Intelligence OS',
        registeredAs: 'ceo',
        owner: { name: 'QA Owner', employeeId: '1001', role: 'ceo', department: 'Management' },
        departments: ['Management', 'Marketing'],
        employees: [{ name: 'QA Owner', employeeId: '1001', role: 'ceo', department: 'Management', deviceId: '1001' }],
        preferences: { workHours: 8, weekdays: ['sun', 'mon', 'tue', 'wed', 'thu'] },
      },
    });
    assert.equal(company.response.status, 200);
    assert.equal(company.value.companyName, 'QA Company');

    const seeded = await api(app.origin, '/api/company/app-data');
    assert.equal(seeded.value.employees[0].name, 'QA Owner');
    const redirected = await api(app.origin, '/');
    assert.equal(redirected.response.headers.get('location'), '/launcher.html');

    const project = await api(app.origin, '/api/projects', { method: 'POST', body: { name: 'atelier-layout', data: { items: [{ type: 'chair' }] } } });
    assert.equal(project.response.status, 201);
    const loaded = await api(app.origin, '/api/projects/atelier-layout');
    assert.equal(loaded.value.data.items[0].type, 'chair');

    const person = await api(app.origin, '/api/people', { method: 'POST', body: { employeeId: '2002', fields: { name: 'Mona QA', department: 'Marketing' } } });
    assert.equal(person.value.name, 'Mona QA');

    const simulator = await api(app.origin, '/api/devices', { method: 'POST', body: { name: 'Manual simulator', type: 'simulator', config: { mode: 'manual' } } });
    assert.equal(simulator.response.status, 201);
    await api(app.origin, `/api/devices/${simulator.value.id}/start`, { method: 'POST', body: {} });
    await api(app.origin, '/api/devices/simulate', { method: 'POST', body: { employeeId: '2002', secondsAgo: 0 } });
    const punches = await api(app.origin, '/api/devices/punches?limit=20');
    assert.equal(punches.value.at(-1).name, 'Mona QA');
    assert.equal(punches.value.at(-1).registered, true);

    const imported = await api(app.origin, '/api/devices/import', {
      method: 'POST',
      body: { filename: 'attendance.csv', text: 'employeeId,timestamp,verify,status\n3003,2026-08-24 09:15:00,0,1\n' },
    });
    assert.equal(imported.value.imported, 1);

    const receiver = await api(app.origin, '/api/devices', { method: 'POST', body: { name: 'Hosted ADMS', type: 'http-push', config: { token: 'push-secret' } } });
    const deniedPush = await fetch(`${app.origin}/api/device-push/${receiver.value.id}`, { method: 'POST', body: 'ATTLOG\t4004\t0\t2026-08-24 10:00:00\t1' });
    assert.equal(deniedPush.status, 401);
    const acceptedPush = await fetch(`${app.origin}/api/device-push/${receiver.value.id}?token=push-secret`, { method: 'POST', body: 'ATTLOG\t4004\t0\t2026-08-24 10:00:00\t1' });
    assert.equal(acceptedPush.status, 200);
    assert.equal(await acceptedPush.text(), 'OK:1');

    const scan = await api(app.origin, '/api/devices/scan', { method: 'POST', body: {} });
    assert.equal(scan.response.status, 409);
    assert.match(scan.value.error || '', /LAN device access is disabled/);

    const backup = await api(app.origin, '/api/backup');
    assert.equal(backup.response.status, 200);
    assert.equal(backup.value.app, 'SEO For All OS Node.js');
    assert.equal(backup.value.company.companyName, 'QA Company');
    assert.ok(backup.value.projects.length >= 1);
    assert.ok(backup.value.punches.length >= 3);

    const audit = await api(app.origin, '/api/audit?limit=1000');
    assert.ok(audit.value.some((row) => row.action === 'company.save'));
    assert.ok(audit.value.some((row) => row.action === 'device.punch'));
  } finally {
    await app.close();
  }
});

test('public deployment authentication and CSRF guard reject unauthorized writes', async () => {
  const app = await startApplication({ username: 'admin', password: 'correct horse battery staple' });
  const auth = `Basic ${Buffer.from('admin:correct horse battery staple').toString('base64')}`;
  try {
    const noAuth = await api(app.origin, '/launcher.html');
    assert.equal(noAuth.response.status, 401);
    const withAuth = await api(app.origin, '/launcher.html', { headers: { Authorization: auth } });
    assert.equal(withAuth.response.status, 200);

    const noCsrfResponse = await fetch(app.origin + '/api/company', {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(noCsrfResponse.status, 403);

    const health = await api(app.origin, '/api/health');
    assert.equal(health.response.status, 200);
  } finally {
    await app.close();
  }
});
