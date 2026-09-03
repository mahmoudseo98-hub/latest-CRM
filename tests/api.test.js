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
  const { session: _session, ...rest } = options;
  const init = { redirect: 'manual', ...rest, headers: { ...(rest.headers || {}) } };
  if (init.body && typeof init.body !== 'string') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  if (init.method && !['GET', 'HEAD'].includes(init.method)) init.headers['X-SEO-Requested-With'] = 'web';
  if (options.session) {
    init.headers.Cookie = options.session.cookie;
    if (init.method && !['GET', 'HEAD'].includes(init.method)) init.headers['X-CSRF-Token'] = options.session.csrf;
  }
  const response = await fetch(origin + pathname, init);
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  return { response, value };
}

function cookiesFrom(response) {
  return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

// Creates the first (owner) account and returns what is needed to act as them.
async function signInAsOwner(origin, headers = {}) {
  const created = await api(origin, '/api/auth/bootstrap', {
    method: 'POST',
    headers,
    body: { email: 'owner@example.com', displayName: 'Test Owner', password: 'correct horse battery' },
  });
  assert.equal(created.response.status, 201);
  return { cookie: cookiesFrom(created.response), csrf: created.value.csrfToken, user: created.value.user };
}

// Binds a session to every call so each test reads as the signed-in owner.
function withSession(origin, session) {
  return (pathname, options = {}) => api(origin, pathname, { session, ...options });
}

test('complete server workflow persists company, projects, people, devices, punches, imports, and backup', async () => {
  const app = await startApplication();
  try {
    // With no account yet, everyone is sent to the sign-in page (in "create the
    // owner account" mode) rather than straight into setup.
    const anonymous = await api(app.origin, '/');
    assert.equal(anonymous.response.status, 302);
    assert.equal(anonymous.response.headers.get('location'), '/signin.html');

    const session = await signInAsOwner(app.origin);
    assert.equal(session.user.baseRole, 'owner');
    const call = withSession(app.origin, session);

    const root = await call('/');
    assert.equal(root.response.status, 302);
    assert.equal(root.response.headers.get('location'), '/setup.html');

    const setupPage = await call('/setup.html');
    assert.equal(setupPage.response.status, 200);
    assert.match(setupPage.value, /STEP 1 \/ 7/);

    const company = await call('/api/company', {
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

    const seeded = await call('/api/company/app-data');
    assert.equal(seeded.value.employees[0].name, 'QA Owner');
    const redirected = await call('/');
    assert.equal(redirected.response.headers.get('location'), '/launcher.html');

    const project = await call('/api/projects', { method: 'POST', body: { name: 'atelier-layout', data: { items: [{ type: 'chair' }] } } });
    assert.equal(project.response.status, 201);
    const loaded = await call('/api/projects/atelier-layout');
    assert.equal(loaded.value.data.items[0].type, 'chair');

    const person = await call('/api/people', { method: 'POST', body: { employeeId: '2002', fields: { name: 'Mona QA', department: 'Marketing' } } });
    assert.equal(person.value.name, 'Mona QA');

    const simulator = await call('/api/devices', { method: 'POST', body: { name: 'Manual simulator', type: 'simulator', config: { mode: 'manual' } } });
    assert.equal(simulator.response.status, 201);
    await call(`/api/devices/${simulator.value.id}/start`, { method: 'POST', body: {} });
    await call('/api/devices/simulate', { method: 'POST', body: { employeeId: '2002', secondsAgo: 0 } });
    const punches = await call('/api/devices/punches?limit=20');
    assert.equal(punches.value.at(-1).name, 'Mona QA');
    assert.equal(punches.value.at(-1).registered, true);

    const imported = await call('/api/devices/import', {
      method: 'POST',
      body: { filename: 'attendance.csv', text: 'employeeId,timestamp,verify,status\n3003,2026-08-24 09:15:00,0,1\n' },
    });
    assert.equal(imported.value.imported, 1);

    const receiver = await call('/api/devices', { method: 'POST', body: { name: 'Hosted ADMS', type: 'http-push', config: { token: 'push-secret' } } });
    const deniedPush = await fetch(`${app.origin}/api/device-push/${receiver.value.id}`, { method: 'POST', body: 'ATTLOG\t4004\t0\t2026-08-24 10:00:00\t1' });
    assert.equal(deniedPush.status, 401);
    const acceptedPush = await fetch(`${app.origin}/api/device-push/${receiver.value.id}?token=push-secret`, { method: 'POST', body: 'ATTLOG\t4004\t0\t2026-08-24 10:00:00\t1' });
    assert.equal(acceptedPush.status, 200);
    assert.equal(await acceptedPush.text(), 'OK:1');

    const scan = await call('/api/devices/scan', { method: 'POST', body: {} });
    assert.equal(scan.response.status, 409);
    assert.match(scan.value.error || '', /LAN device access is disabled/);

    const backup = await call('/api/backup');
    assert.equal(backup.response.status, 200);
    assert.equal(backup.value.app, 'SEO For All OS Node.js');
    assert.equal(backup.value.company.companyName, 'QA Company');
    assert.ok(backup.value.projects.length >= 1);
    assert.ok(backup.value.punches.length >= 3);

    const audit = await call('/api/audit?limit=1000');
    assert.ok(audit.value.some((row) => row.action === 'company.save'));
    assert.ok(audit.value.some((row) => row.action === 'device.punch'));
  } finally {
    await app.close();
  }
});

test('first-run setup is guarded by the deployment credentials and creates exactly one owner', async () => {
  const app = await startApplication({ username: 'admin', password: 'correct horse battery staple' });
  const auth = `Basic ${Buffer.from('admin:correct horse battery staple').toString('base64')}`;
  try {
    // Before an owner exists the shared credential guards the first-run window, so
    // a stranger cannot claim the owner account on a public URL.
    const noAuth = await api(app.origin, '/signin.html');
    assert.equal(noAuth.response.status, 401);

    const signinPage = await api(app.origin, '/signin.html', { headers: { Authorization: auth } });
    assert.equal(signinPage.response.status, 200);

    const state = await api(app.origin, '/api/auth/state', { headers: { Authorization: auth } });
    assert.equal(state.value.bootstrapped, false);

    const weak = await api(app.origin, '/api/auth/bootstrap', {
      method: 'POST',
      headers: { Authorization: auth },
      body: { email: 'owner@example.com', displayName: 'Owner', password: 'short' },
    });
    assert.equal(weak.response.status, 400);

    const session = await signInAsOwner(app.origin, { Authorization: auth });
    assert.equal(session.user.baseRole, 'owner');

    // Sign-up closes permanently once an owner exists.
    const second = await api(app.origin, '/api/auth/bootstrap', {
      method: 'POST',
      headers: { Authorization: auth },
      body: { email: 'intruder@example.com', displayName: 'Intruder', password: 'another long password' },
    });
    assert.equal(second.response.status, 403);

    // And the shared credential stops opening the application.
    const staleBasic = await api(app.origin, '/launcher.html', { headers: { Authorization: auth } });
    assert.equal(staleBasic.response.status, 302);
    assert.match(staleBasic.response.headers.get('location') || '', /signin\.html/);

    const withSessionCookie = await api(app.origin, '/launcher.html', { session });
    assert.equal(withSessionCookie.response.status, 200);
  } finally {
    await app.close();
  }
});

test('sessions gate the app, survive sign-in, and end on sign-out', async () => {
  const app = await startApplication();
  try {
    const session = await signInAsOwner(app.origin);

    // A page request without a session is redirected, and the intended
    // destination is preserved so sign-in can return there.
    const guardedPage = await api(app.origin, '/seo-for-all/index.html');
    assert.equal(guardedPage.response.status, 302);
    assert.match(guardedPage.response.headers.get('location') || '', /next=%2Fseo-for-all%2Findex\.html/);

    // An API request without a session gets a clean 401, not a redirect.
    const guardedApi = await api(app.origin, '/api/company');
    assert.equal(guardedApi.response.status, 401);

    assert.equal((await api(app.origin, '/api/company', { session })).response.status, 200);

    const me = await api(app.origin, '/api/auth/me', { session });
    assert.equal(me.value.user.email, 'owner@example.com');

    // Wrong credentials give the same answer whether or not the email exists.
    const wrongPassword = await api(app.origin, '/api/auth/login', {
      method: 'POST', body: { email: 'owner@example.com', password: 'not the password' },
    });
    const unknownEmail = await api(app.origin, '/api/auth/login', {
      method: 'POST', body: { email: 'nobody@example.com', password: 'not the password' },
    });
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(unknownEmail.response.status, 401);
    assert.equal(wrongPassword.value.error, unknownEmail.value.error);

    const good = await api(app.origin, '/api/auth/login', {
      method: 'POST', body: { email: 'owner@example.com', password: 'correct horse battery' },
    });
    assert.equal(good.response.status, 200);
    const fresh = { cookie: cookiesFrom(good.response), csrf: good.value.csrfToken };
    assert.equal((await api(app.origin, '/api/company', { session: fresh })).response.status, 200);

    await api(app.origin, '/api/auth/logout', { method: 'POST', session: fresh });
    assert.equal((await api(app.origin, '/api/company', { session: fresh })).response.status, 401);
  } finally {
    await app.close();
  }
});

test('credentials are hashed, never echoed, and stay out of backups', async () => {
  const app = await startApplication();
  try {
    const session = await signInAsOwner(app.origin);

    // Nothing secret comes back from the API.
    const me = await api(app.origin, '/api/auth/me', { session });
    const serialized = JSON.stringify(me.value);
    for (const secret of ['passwordHash', 'passwordSalt', 'correct horse battery']) {
      assert.ok(!serialized.includes(secret), `${secret} must not be returned by /api/auth/me`);
    }

    // The password is scrypt-hashed with a per-user salt, never stored in the clear.
    const stored = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'users.json'), 'utf8')).users[0];
    assert.equal(stored.passwordHash.length, 128);
    assert.equal(stored.passwordSalt.length, 32);
    assert.ok(!JSON.stringify(stored).includes('correct horse battery'));

    // Sessions are stored as hashes, so a leaked data directory yields no live token.
    const sessionFile = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'sessions.json'), 'utf8')).sessions;
    assert.ok(sessionFile.length >= 1);
    assert.ok(sessionFile.every((row) => row.tokenHash && !row.token));

    // And none of it reaches an export.
    const backup = await api(app.origin, '/api/backup', { session });
    const blob = JSON.stringify(backup.value);
    for (const secret of ['passwordHash', 'passwordSalt', 'tokenHash', 'correct horse battery']) {
      assert.ok(!blob.includes(secret), `${secret} must not appear in a backup`);
    }
  } finally {
    await app.close();
  }
});

test('mutations require the CSRF token bound to the session', async () => {
  const app = await startApplication();
  try {
    const session = await signInAsOwner(app.origin);

    // Cookie present, CSRF header missing: a cross-site form can do exactly this.
    const noToken = await fetch(app.origin + '/api/company', {
      method: 'PUT',
      headers: { Cookie: session.cookie, 'Content-Type': 'application/json', 'X-SEO-Requested-With': 'web' },
      body: '{}',
    });
    assert.equal(noToken.status, 403);

    const wrongToken = await fetch(app.origin + '/api/company', {
      method: 'PUT',
      headers: {
        Cookie: session.cookie, 'Content-Type': 'application/json',
        'X-SEO-Requested-With': 'web', 'X-CSRF-Token': 'forged',
      },
      body: '{}',
    });
    assert.equal(wrongToken.status, 403);

    const health = await api(app.origin, '/api/health');
    assert.equal(health.response.status, 200);
  } finally {
    await app.close();
  }
});

test('repeated failed sign-ins are rate limited per account without locking a shared IP', async () => {
  const app = await startApplication();
  try {
    await signInAsOwner(app.origin);
    const attempt = (email) => api(app.origin, '/api/auth/login', {
      method: 'POST', body: { email, password: 'wrong every time' },
    });

    let limited = null;
    for (let i = 0; i < 12; i += 1) {
      const res = await attempt('owner@example.com');
      if (res.response.status === 429) { limited = i + 1; break; }
    }
    assert.ok(limited, 'repeated failures against one account must eventually be rate limited');

    // A colleague on the same IP, and the real password, still get through.
    const other = await attempt('someone-else@example.com');
    assert.equal(other.response.status, 401, 'a different account is not collateral damage');
  } finally {
    await app.close();
  }
});
