/* web-api.js — browser-compatible replacement for Electron's preload bridge. */
(function installWebApi() {
  'use strict';

  const selectedFiles = new Map();
  const eventCallbacks = new Set();
  let eventSource = null;
  let runningWedgeId = null;
  let wedgeBuffer = '';
  let wedgeTimer = null;

  function readCookie(name) {
    const parts = String(document.cookie || '').split(';');
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
    }
    return '';
  }

  async function request(path, options) {
    const init = Object.assign({ credentials: 'same-origin' }, options || {});
    init.headers = Object.assign({}, init.headers || {});
    if (init.body && !(init.body instanceof FormData) && typeof init.body !== 'string') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(init.body);
    }
    if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
      init.headers['X-SEO-Requested-With'] = 'web';
      // Double-submit CSRF: echo the readable cookie back as a header. A cross-site
      // form can send the cookie but cannot read it to set this.
      const csrf = readCookie('seo_csrf');
      if (csrf) init.headers['X-CSRF-Token'] = csrf;
    }
    const response = await fetch(path, init);
    const contentType = response.headers.get('content-type') || '';
    const value = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = value && typeof value === 'object' ? value.error || value.message : value;
      throw new Error(message || `Request failed (${response.status})`);
    }
    return value;
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '';
      input.style.display = 'none';
      document.body.appendChild(input);
      const finish = (token) => { input.remove(); resolve(token || null); };
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return finish(null);
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
        selectedFiles.set(id, file);
        finish(`webfile:${id}:${encodeURIComponent(file.name)}`);
      }, { once: true });
      input.addEventListener('cancel', () => finish(null), { once: true });
      input.click();
    });
  }

  function tokenFile(token) {
    const match = String(token || '').match(/^webfile:([^:]+):/);
    return match ? selectedFiles.get(match[1]) || null : null;
  }

  function tokenFilename(token) {
    const match = String(token || '').match(/^webfile:[^:]+:(.*)$/);
    if (!match) return 'selected-file';
    try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
  }

  function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  }

  function fileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'));
      reader.readAsText(file);
    });
  }

  function download(filename, data, isBase64, mime) {
    let blob;
    if (isBase64) {
      const binary = atob(String(data || ''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      blob = new Blob([bytes], { type: mime || mimeFor(filename) });
    } else if (data instanceof Blob) blob = data;
    else blob = new Blob([data == null ? '' : data], { type: mime || mimeFor(filename) });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'download';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 1000);
  }

  function mimeFor(filename) {
    const extension = String(filename || '').split('.').pop().toLowerCase();
    return { pdf: 'application/pdf', csv: 'text/csv;charset=utf-8', json: 'application/json', png: 'image/png', txt: 'text/plain;charset=utf-8' }[extension] || 'application/octet-stream';
  }

  function allowedPage(page) {
    const clean = String(page || '').split('?')[0];
    return ['launcher.html', 'setup.html', 'devices.html', 'seo-for-all/index.html', 'atelier/index.html'].includes(clean);
  }

  function ensureEvents() {
    if (eventSource || !window.EventSource) return;
    eventSource = new EventSource('/api/events');
    eventSource.onmessage = (message) => {
      let event;
      try { event = JSON.parse(message.data); } catch (_) { return; }
      eventCallbacks.forEach((callback) => {
        try { callback(event); } catch (error) { console.error('device event callback failed', error); }
      });
    };
    eventSource.onerror = () => { /* EventSource reconnects automatically. */ };
  }

  async function refreshWedgeState() {
    try {
      const devices = await request('/api/devices');
      const wedge = devices.find((device) => device.type === 'keyboard-wedge' && device.status === 'running');
      runningWedgeId = wedge ? wedge.id : null;
    } catch (_) { runningWedgeId = null; }
  }

  function flushWedge() {
    if (wedgeTimer) clearTimeout(wedgeTimer);
    wedgeTimer = null;
    const value = wedgeBuffer;
    wedgeBuffer = '';
    if (!value || !runningWedgeId) return;
    request(`/api/devices/${encodeURIComponent(runningWedgeId)}/wedge`, { method: 'POST', body: { employeeId: value } }).catch((error) => console.error('wedge punch failed', error));
  }

  document.addEventListener('keydown', (event) => {
    if (!runningWedgeId || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
    if (event.key === 'Enter') { flushWedge(); return; }
    if (event.key === 'Backspace') { wedgeBuffer = wedgeBuffer.slice(0, -1); return; }
    if (event.key.length === 1 && /[0-9a-zA-Z_-]/.test(event.key)) {
      wedgeBuffer += event.key;
      if (wedgeBuffer.length > 80) wedgeBuffer = wedgeBuffer.slice(-80);
      if (wedgeTimer) clearTimeout(wedgeTimer);
      wedgeTimer = setTimeout(flushWedge, 400);
    }
  }, true);

  const api = {
    getInfo: () => request('/api/info'),
    navigate: async (page) => {
      if (!allowedPage(page)) throw new Error('Page is not allowed.');
      window.location.assign(`/${String(page).replace(/^\/+/, '')}`);
      return true;
    },
    openDataFolder: async () => {
      const response = await fetch('/api/backup', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not prepare the server backup.');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      download(match ? match[1] : 'seo-for-all-server-backup.json', blob, false, 'application/json');
      return true;
    },
    openDocs: async () => { window.open('/docs/USER-GUIDE-WEB.md', '_blank', 'noopener'); return true; },

    company: {
      get: () => request('/api/company'),
      save: (config) => request('/api/company', { method: 'PUT', body: config }),
      chooseLogo: async () => {
        const token = await pickFile('image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon');
        if (!token) return null;
        const file = tokenFile(token);
        if (!file) return null;
        if (file.size > 6 * 1024 * 1024) throw new Error('Logo must be 6 MB or smaller.');
        const dataUrl = await fileAsDataUrl(file);
        const result = await request('/api/company/logo', { method: 'POST', body: { mimeType: file.type, dataBase64: dataUrl.split(',')[1] || '' } });
        return result.filename;
      },
      reset: () => request('/api/company/reset', { method: 'POST', body: {} }),
    },
    pickFolder: async () => {
      if (window.showDirectoryPicker) {
        try { const handle = await window.showDirectoryPicker({ mode: 'readwrite' }); return `Browser folder: ${handle.name}`; } catch (_) { return null; }
      }
      return 'Browser downloads folder';
    },

    saveFile: async (options) => `download:${encodeURIComponent((options && options.defaultPath) || 'download')}`,
    openFile: (options) => {
      const extensions = options && options.filters && options.filters.flatMap((filter) => filter.extensions || []);
      const accept = extensions && extensions.length ? extensions.map((extension) => `.${extension}`).join(',') : '';
      return pickFile(accept);
    },
    writeFile: async (filePath, data, isBase64) => {
      const match = String(filePath || '').match(/^download:(.*)$/);
      const filename = match ? decodeURIComponent(match[1]) : String(filePath || 'download');
      download(filename, data, Boolean(isBase64));
      request('/api/audit', { method: 'POST', body: { action: 'file.download', target: filename, detail: { browser: true } } }).catch(() => {});
      return { ok: true, file: filename };
    },
    readFile: async (filePath, asBase64) => {
      const file = tokenFile(filePath);
      if (!file) return { ok: false, error: 'Selected file is no longer available.' };
      if (asBase64) {
        const dataUrl = await fileAsDataUrl(file);
        return { ok: true, data: dataUrl.split(',')[1] || '' };
      }
      return { ok: true, data: await fileAsText(file) };
    },

    saveProject: (name, data) => request('/api/projects', { method: 'POST', body: { name, data } }),
    listProjects: () => request('/api/projects'),
    loadProject: (name) => request(`/api/projects/${encodeURIComponent(name)}`),
    deleteProject: (name) => request(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }),

    auditLog: (action, target, detail) => request('/api/audit', { method: 'POST', body: { action, target, detail } }),
    auditRead: (limit) => request(`/api/audit?limit=${encodeURIComponent(limit || 200)}`),

    devices: {
      list: () => request('/api/devices'),
      add: (config) => request('/api/devices', { method: 'POST', body: config }),
      remove: async (id) => { const value = await request(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }); await refreshWedgeState(); return value; },
      start: async (id) => { const value = await request(`/api/devices/${encodeURIComponent(id)}/start`, { method: 'POST', body: {} }); await refreshWedgeState(); return value; },
      stop: async (id) => { const value = await request(`/api/devices/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }); await refreshWedgeState(); return value; },
      test: (id) => request(`/api/devices/${encodeURIComponent(id)}/test`, { method: 'POST', body: {} }),
      simulatePunch: (employeeId, secondsAgo) => request('/api/devices/simulate', { method: 'POST', body: { employeeId, secondsAgo } }),
      importFile: async (fileToken, profile) => {
        const file = tokenFile(fileToken);
        if (!file) throw new Error('Choose an attendance TXT, CSV, or DAT file first.');
        if (file.size > 10 * 1024 * 1024) throw new Error('Attendance file must be 10 MB or smaller.');
        return request('/api/devices/import', { method: 'POST', body: { filename: tokenFilename(fileToken), text: await fileAsText(file), profile: profile || null } });
      },
      scanNetwork: () => request('/api/devices/scan', { method: 'POST', body: {} }),
      onEvent: (callback) => {
        eventCallbacks.add(callback);
        ensureEvents();
        return () => eventCallbacks.delete(callback);
      },
    },

    people: {
      list: () => request('/api/people'),
      register: (employeeId, fields) => request('/api/people', { method: 'POST', body: { employeeId, fields } }),
      remove: (employeeId) => request(`/api/people/${encodeURIComponent(employeeId)}`, { method: 'DELETE' }),
    },
  };

  window.desktopApi = api;
  window.webApi = api;
  ensureEvents();
  refreshWedgeState();
})();
