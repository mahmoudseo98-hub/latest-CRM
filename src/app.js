'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AuditStore } = require('./audit-store');
const { CompanyStore, validLogoName } = require('./company-store');
const { PeopleRegistry } = require('./people-registry');
const { ProjectStore } = require('./project-store');
const { DeviceManager } = require('./device-manager');
const { ensureDir, writeJsonAtomic } = require('./storage');

const VERSION = '1.0.0';
const LOCKED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Configuration required</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B1220;color:#F8FAFC;
font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:34rem;padding:2rem}
h1{font-size:1.5rem;margin:0 0 .75rem}p{color:#CBD5E1;margin:0 0 1rem}
code{background:#172033;border:1px solid #2A3648;border-radius:6px;padding:.15rem .4rem;font-size:.9em}
ul{color:#CBD5E1;padding-left:1.2rem}</style></head><body><main>
<h1>Configuration required</h1>
<p>This deployment is running in production without sign-in credentials, so it is not serving the
application. This protects company, attendance and payroll data from being read by anyone with the URL.</p>
<p>Set both of these environment variables on the host, then restart the app:</p>
<ul><li><code>APP_USERNAME</code></li><li><code>APP_PASSWORD</code></li></ul>
</main></body></html>`;
const MAX_JSON_BYTES = 12 * 1024 * 1024;
const MAX_PUSH_BYTES = 2 * 1024 * 1024;

function createApplication(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const publicDir = path.resolve(options.publicDir || path.join(projectRoot, 'public'));
  const dataDir = ensureDir(path.resolve(options.dataDir || process.env.DATA_DIR || path.join(projectRoot, 'data')));
  const username = String(options.username != null ? options.username : process.env.APP_USERNAME || '');
  const password = String(options.password != null ? options.password : process.env.APP_PASSWORD || '');
  const authEnabled = Boolean(username && password);
  const allowLan = options.allowLan != null ? Boolean(options.allowLan) : String(process.env.ENABLE_LAN_DEVICE_ACCESS || '').toLowerCase() === 'true';

  const audit = new AuditStore(dataDir);
  const company = new CompanyStore(dataDir);
  const people = new PeopleRegistry(dataDir);
  const projects = new ProjectStore(dataDir);
  const devices = new DeviceManager({ dataDir, audit, people, company, allowLan }).init();
  const eventClients = new Set();

  const broadcast = (event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of eventClients) {
      try { response.write(payload); } catch (_) { eventClients.delete(response); }
    }
  };
  devices.on('event', broadcast);
  const heartbeat = setInterval(() => {
    for (const response of eventClients) {
      try { response.write(': heartbeat\n\n'); } catch (_) { eventClients.delete(response); }
    }
  }, 20000);
  heartbeat.unref();

  const context = { projectRoot, publicDir, dataDir, audit, company, people, projects, devices, authEnabled, allowLan, eventClients };

  async function handler(request, response) {
    setSecurityHeaders(response);
    const url = new URL(request.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const pushRoute = isPushRoute(pathname);

    try {
      if (pathname === '/api/health' && request.method === 'GET') {
        return sendJson(response, 200, { status: 'ok', version: VERSION, timestamp: new Date().toISOString() });
      }
      // Fail closed in production. Without credentials this app served the whole
      // company — people, attendance, payroll and audit data — to anyone with the
      // URL. Refuse to serve rather than silently exposing it.
      if (!pushRoute && !authEnabled && process.env.NODE_ENV === 'production') {
        response.statusCode = 503;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        return response.end(LOCKED_PAGE);
      }
      if (!pushRoute && authEnabled && !authorized(request, username, password)) {
        response.setHeader('WWW-Authenticate', 'Basic realm="SEO For All OS", charset="UTF-8"');
        return sendJson(response, 401, { error: 'Authentication required.' });
      }
      if (!pushRoute && isMutation(request.method) && pathname.startsWith('/api/') && request.headers['x-seo-requested-with'] !== 'web') {
        return sendJson(response, 403, { error: 'Invalid same-origin request.' });
      }

      if (pushRoute) return await handlePush(request, response, url, context);
      if (pathname === '/api/events' && request.method === 'GET') return openEventStream(request, response, eventClients);
      if (pathname === '/company-seed.js' && request.method === 'GET') return sendCompanySeed(response, company);
      if (pathname.startsWith('/company-logo/') && request.method === 'GET') return serveCompanyLogo(response, company, pathname);

      if (pathname.startsWith('/api/')) return await handleApi(request, response, url, context);

      if (pathname === '/') {
        response.statusCode = 302;
        response.setHeader('Location', company.get() ? '/launcher.html' : '/setup.html');
        response.end();
        return;
      }
      return serveStatic(response, publicDir, pathname);
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      if (status >= 500) audit.log('server.error', pathname, { message: String(error.message || error) });
      return sendJson(response, status, { error: status >= 500 ? 'Internal Server Error' : String(error.message || error), message: status >= 500 && process.env.NODE_ENV === 'development' ? String(error.message || error) : undefined });
    }
  }

  async function close() {
    clearInterval(heartbeat);
    for (const response of eventClients) {
      try { response.end(); } catch (_) {}
    }
    eventClients.clear();
    await devices.shutdown();
  }

  return { handler, context, close };
}

async function handleApi(request, response, url, context) {
  const { pathname, searchParams } = url;
  const { audit, company, people, projects, devices, dataDir } = context;

  if (pathname === '/api/info' && request.method === 'GET') {
    return sendJson(response, 200, {
      version: VERSION,
      runtime: `Node.js ${process.versions.node}`,
      electron: 'WEB',
      chrome: 'BROWSER',
      node: process.versions.node,
      platform: process.platform,
      userData: 'Server-managed storage',
      authEnabled: context.authEnabled,
      lanDeviceAccess: context.allowLan,
    });
  }

  if (pathname === '/api/company' && request.method === 'GET') return sendJson(response, 200, company.get());
  if (pathname === '/api/company/app-data' && request.method === 'GET') return sendJson(response, 200, company.buildAppData());
  if (pathname === '/api/company' && request.method === 'PUT') {
    const saved = company.save(await readJsonBody(request));
    audit.log('company.save', 'company/config.json', { company: saved.companyName, employees: saved.employees.length, registeredAs: saved.registeredAs });
    return sendJson(response, 200, saved);
  }
  if (pathname === '/api/company/logo' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const filename = company.saveLogo({ mimeType: body.mimeType, dataBase64: body.dataBase64 });
    const cfg = company.get();
    if (cfg) company.save({ ...cfg, logo: filename });
    audit.log('company.logo', filename, { bytes: String(body.dataBase64 || '').length });
    return sendJson(response, 200, { filename });
  }
  if (pathname === '/api/company/reset' && request.method === 'POST') {
    const removed = company.reset();
    audit.log('company.reset', 'company/config.json', { removed });
    return sendJson(response, 200, { ok: true, removed });
  }

  if (pathname === '/api/projects' && request.method === 'GET') return sendJson(response, 200, projects.list());
  if (pathname === '/api/projects' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const saved = projects.save(body.name, body.data);
    audit.log('project.save', body.name, { size: saved.size });
    return sendJson(response, 201, saved);
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && request.method === 'GET') return sendJson(response, 200, projects.load(decodeURIComponent(projectMatch[1])));
  if (projectMatch && request.method === 'DELETE') {
    const name = decodeURIComponent(projectMatch[1]);
    const removed = projects.remove(name);
    if (!removed) throw httpError(404, 'Project not found.');
    audit.log('project.delete', name, {});
    return sendJson(response, 200, { ok: true });
  }

  if (pathname === '/api/audit' && request.method === 'GET') return sendJson(response, 200, audit.read(searchParams.get('limit')));
  if (pathname === '/api/audit' && request.method === 'POST') {
    const body = await readJsonBody(request);
    return sendJson(response, 201, audit.log(body.action, body.target, body.detail));
  }

  if (pathname === '/api/devices' && request.method === 'GET') return sendJson(response, 200, devices.list());
  if (pathname === '/api/devices' && request.method === 'POST') return sendJson(response, 201, devices.add(await readJsonBody(request)));
  if (pathname === '/api/devices/simulate' && request.method === 'POST') {
    const body = await readJsonBody(request);
    return sendJson(response, 200, devices.simulatePunch(body.employeeId, body.secondsAgo));
  }
  if (pathname === '/api/devices/import' && request.method === 'POST') {
    const body = await readJsonBody(request);
    return sendJson(response, 200, devices.importText(body.filename, body.text, body.profile));
  }
  if (pathname === '/api/devices/scan' && request.method === 'POST') return sendJson(response, 200, await devices.scanNetwork());
  if (pathname === '/api/devices/punches' && request.method === 'GET') return sendJson(response, 200, devices.punches(searchParams.get('limit')));
  const deviceMatch = pathname.match(/^\/api\/devices\/([^/]+)(?:\/(start|stop|test|wedge))?$/);
  if (deviceMatch) {
    const id = decodeURIComponent(deviceMatch[1]);
    const action = deviceMatch[2];
    if (!action && request.method === 'DELETE') return sendJson(response, 200, { ok: await devices.remove(id) });
    if (request.method === 'POST' && action === 'start') return sendJson(response, 200, await devices.start(id));
    if (request.method === 'POST' && action === 'stop') return sendJson(response, 200, await devices.stop(id));
    if (request.method === 'POST' && action === 'test') return sendJson(response, 200, await devices.test(id));
    if (request.method === 'POST' && action === 'wedge') {
      const body = await readJsonBody(request);
      return sendJson(response, 200, devices.wedgePunch(id, body.employeeId));
    }
  }

  if (pathname === '/api/people' && request.method === 'GET') return sendJson(response, 200, people.list());
  if (pathname === '/api/people' && request.method === 'POST') {
    const body = await readJsonBody(request);
    return sendJson(response, 201, devices.registerPerson(body.employeeId, body.fields || body));
  }
  const peopleMatch = pathname.match(/^\/api\/people\/([^/]+)$/);
  if (peopleMatch && request.method === 'DELETE') return sendJson(response, 200, { ok: devices.removePerson(decodeURIComponent(peopleMatch[1])) });

  if (pathname === '/api/backup' && request.method === 'GET') return sendJsonDownload(response, buildBackup(context), `seo-for-all-server-backup-${new Date().toISOString().slice(0, 10)}.json`);
  if (pathname === '/api/backup' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const result = await restoreBackup(context, body);
    audit.log('backup.import', 'server', result);
    return sendJson(response, 200, result);
  }

  if (pathname === '/api/storage/status' && request.method === 'GET') {
    return sendJson(response, 200, { writable: isWritable(dataDir), location: 'server-managed', projects: projects.list().length, people: people.list().length, devices: devices.list().length });
  }

  throw httpError(404, 'API route not found.');
}

async function handlePush(request, response, url, context) {
  const match = url.pathname.match(/^\/api\/device-push\/([^/]+)$/);
  const deviceId = match ? decodeURIComponent(match[1]) : null;
  if (request.method === 'GET') {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('OK');
    return;
  }
  if (request.method !== 'POST') throw httpError(405, 'Method not allowed.');
  const body = await readRawBody(request, MAX_PUSH_BYTES);
  const result = context.devices.receiveHttpPush(deviceId, { body, headers: request.headers, url: request.url });
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(result.accepted ? `OK:${result.accepted}` : 'OK');
}

function isPushRoute(pathname) {
  return pathname === '/iclock/cdata' || pathname === '/api/device-push' || /^\/api\/device-push\/[^/]+$/.test(pathname);
}

function openEventStream(request, response, clients) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.write('retry: 2000\n: connected\n\n');
  clients.add(response);
  request.on('close', () => clients.delete(response));
}

function sendCompanySeed(response, company) {
  const json = JSON.stringify({ appData: company.buildAppData() }).replace(/</g, '\\u003c');
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`window.__companyDataSync=${json};`);
}

function serveCompanyLogo(response, company, pathname) {
  const filename = path.basename(pathname);
  if (!validLogoName(filename)) throw httpError(404, 'Logo not found.');
  const file = company.logoPath(filename);
  if (!file) throw httpError(404, 'Logo not found.');
  return sendFile(response, file, { cache: false });
}

function serveStatic(response, publicDir, pathname) {
  const relative = pathname.replace(/^\/+/, '') || 'launcher.html';
  const file = path.resolve(publicDir, relative);
  if (file !== publicDir && !file.startsWith(`${publicDir}${path.sep}`)) throw httpError(403, 'Forbidden.');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw httpError(404, 'Not found.');
  return sendFile(response, file, { cache: /\/vendor\//.test(pathname) || /\.(woff2?|ttf)$/.test(pathname) });
}

function sendFile(response, file, { cache }) {
  response.statusCode = 200;
  response.setHeader('Content-Type', mimeType(file));
  response.setHeader('Content-Length', fs.statSync(file).size);
  response.setHeader('Cache-Control', cache ? 'public, max-age=31536000, immutable' : 'no-cache');
  fs.createReadStream(file).on('error', (error) => response.destroy(error)).pipe(response);
}

function mimeType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  }[extension] || 'application/octet-stream';
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(self), display-capture=(self), microphone=(self)');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function authorized(request, username, password) {
  const header = String(request.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch (_) { return false; }
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  return safeEqual(decoded.slice(0, separator), username) && safeEqual(decoded.slice(separator + 1), password);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isMutation(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

async function readJsonBody(request) {
  const raw = await readRawBody(request, MAX_JSON_BYTES);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch (_) { throw httpError(400, 'Invalid JSON body.'); }
}

function readRawBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, 'Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value === undefined ? null : value);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function sendJsonDownload(response, value, filename) {
  const body = JSON.stringify(value, null, 2);
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`);
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildBackup(context) {
  const cfg = context.company.get();
  let logo = null;
  if (cfg && cfg.logo) {
    const file = context.company.logoPath(cfg.logo);
    if (file) logo = { filename: cfg.logo, dataBase64: fs.readFileSync(file).toString('base64') };
  }
  return {
    version: 1,
    app: 'SEO For All OS Node.js',
    exportedAt: new Date().toISOString(),
    company: cfg,
    logo,
    projects: context.projects.export(),
    people: context.people.export(),
    devices: context.devices.devices,
    punches: context.devices.punches(100000),
    audit: context.audit.read(100000),
  };
}

async function restoreBackup(context, backup) {
  if (!backup || backup.version !== 1 || backup.app !== 'SEO For All OS Node.js') throw httpError(400, 'Not a valid SEO For All OS Node.js backup.');
  await context.devices.shutdown();
  if (backup.company) context.company.save(backup.company);
  if (backup.logo && backup.logo.filename && backup.logo.dataBase64) {
    const extension = path.extname(backup.logo.filename).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[extension];
    if (mime) context.company.saveLogo({ mimeType: mime, dataBase64: backup.logo.dataBase64 });
  }
  context.projects.import(backup.projects);
  context.people.import(backup.people);
  context.devices.devices = Array.isArray(backup.devices) ? backup.devices : [];
  context.devices.persist();
  if (Array.isArray(backup.punches)) fs.writeFileSync(context.devices.punchesFile, backup.punches.map((row) => JSON.stringify(row)).join('\n') + (backup.punches.length ? '\n' : ''), { mode: 0o600 });
  if (Array.isArray(backup.audit)) fs.writeFileSync(context.audit.file, backup.audit.map((row) => JSON.stringify(row)).join('\n') + (backup.audit.length ? '\n' : ''), { mode: 0o600 });
  context.devices.init();
  return { ok: true, projects: context.projects.list().length, people: context.people.list().length, devices: context.devices.list().length };
}

function isWritable(directory) {
  const file = path.join(directory, `.write-test-${process.pid}`);
  try { fs.writeFileSync(file, 'ok'); fs.unlinkSync(file); return true; } catch (_) { return false; }
}

module.exports = { createApplication, VERSION, httpError, buildBackup, restoreBackup };
