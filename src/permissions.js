'use strict';

// One policy, consulted by every API handler. Hiding a button in the UI is a
// convenience for the person using it; this file is the part that actually
// decides. Anything not granted here is denied, so a new route is closed until
// someone deliberately opens it.

const CAPABILITIES = [
  'info:read',        // runtime/version banner
  'company:read',     // company profile, app-data seed, logo
  'company:write',    // edit the company profile or its logo
  'company:reset',    // wipe the company profile
  'people:read',      // the registered-people (fingerprint) registry
  'people:write',
  'devices:read',
  'devices:write',    // add or remove a device
  'devices:control',  // start/stop/test/scan/import/simulate a device
  'punches:read',     // attendance events
  'projects:read',
  'projects:write',
  'audit:read',
  'audit:write',
  'backup:export',    // download everything, including people and punches
  'backup:restore',   // overwrite everything
  'storage:read',
  'events:read',      // the server-sent event stream
];

const ALL = Object.freeze(CAPABILITIES.slice());

// Read-only access to the things every signed-in person needs to render a page.
const BASE_READ = ['info:read', 'company:read', 'events:read'];

// Deliberately conservative. company:reset and backup:restore destroy or
// overwrite the whole workspace, so they stay with the owner even for admins.
const ROLE_CAPABILITIES = {
  owner: ALL,
  admin: ALL.filter((c) => c !== 'company:reset' && c !== 'backup:restore'),
  director: [
    ...BASE_READ, 'company:write',
    'people:read', 'people:write',
    'devices:read', 'punches:read',
    'projects:read', 'projects:write',
    'audit:read', 'backup:export', 'storage:read',
  ],
  manager: [
    ...BASE_READ,
    'people:read', 'devices:read', 'punches:read',
    'projects:read', 'projects:write', 'storage:read',
  ],
  lead: [
    ...BASE_READ,
    'people:read', 'punches:read',
    'projects:read', 'projects:write',
  ],
  // An employee gets their own workspace and the company profile. The people
  // registry and punch feed are other people's attendance data, so they are not
  // included here; per-record self-service needs an account/employee link that
  // does not exist yet, and guessing at it would be worse than withholding.
  employee: [...BASE_READ, 'projects:read'],
  client: ['info:read', 'company:read'],
};

function capabilitiesFor(baseRole) {
  const list = ROLE_CAPABILITIES[String(baseRole || '')];
  return list ? list.slice() : [];
}

function can(baseRole, capability) {
  if (!capability) return true; // route needs authentication only
  return capabilitiesFor(baseRole).includes(capability);
}

// Maps a request to the capability it needs. Returning undefined means the route
// is not recognised as a guarded one; callers treat that as "authenticated only".
function requiredCapability(method, pathname) {
  const verb = String(method || 'GET').toUpperCase();
  const read = verb === 'GET' || verb === 'HEAD';

  if (pathname === '/api/info') return 'info:read';
  if (pathname === '/api/events') return 'events:read';
  if (pathname === '/api/storage/status') return 'storage:read';

  if (pathname === '/company-seed.js') return 'company:read';
  if (pathname.startsWith('/company-logo/')) return 'company:read';

  if (pathname === '/api/company/reset') return 'company:reset';
  if (pathname === '/api/company/logo') return 'company:write';
  if (pathname === '/api/company' || pathname === '/api/company/app-data') {
    return read ? 'company:read' : 'company:write';
  }

  if (pathname === '/api/backup') return read ? 'backup:export' : 'backup:restore';

  if (pathname === '/api/audit') return read ? 'audit:read' : 'audit:write';

  if (pathname === '/api/devices/punches') return 'punches:read';
  if (pathname === '/api/devices/scan' || pathname === '/api/devices/simulate'
      || pathname === '/api/devices/import') return 'devices:control';
  if (/^\/api\/devices\/[^/]+\/(start|stop|test|wedge)$/.test(pathname)) return 'devices:control';
  if (pathname === '/api/devices') return read ? 'devices:read' : 'devices:write';
  if (/^\/api\/devices\/[^/]+$/.test(pathname)) return read ? 'devices:read' : 'devices:write';

  if (pathname === '/api/people' || /^\/api\/people\/[^/]+$/.test(pathname)) {
    return read ? 'people:read' : 'people:write';
  }

  if (pathname === '/api/projects' || /^\/api\/projects\/[^/]+$/.test(pathname)) {
    return read ? 'projects:read' : 'projects:write';
  }

  return undefined;
}

module.exports = {
  CAPABILITIES: ALL,
  ROLE_CAPABILITIES,
  capabilitiesFor,
  can,
  requiredCapability,
};
