// devices.js — Fingerprint Devices Hub logic
(function () {
  const api = window.desktopApi;
  const $ = (id) => document.getElementById(id);
  const state = { devices: [], punches: [], people: [] };

  const TYPE_LABEL = {
    'http-push': 'HTTP PUSH',
    'zk-tcp': 'ZK TCP',
    'keyboard-wedge': 'KEYBOARD WEDGE',
    'file-import': 'FILE IMPORT',
    simulator: 'SIMULATOR',
  };
  const TYPE_HINT = {
    'http-push': 'After adding the device, copy its HTTPS push endpoint from the configured-device card into the terminal ADMS/server URL.',
    'zk-tcp': 'Node.js must run on the same private LAN as the terminal. Default ZKTeco port: 4370.',
    'keyboard-wedge': 'Plug the reader into USB. When armed, reads typed IDs. No device-side config.',
    simulator: 'Virtual device — generates punches so you can test workflows without hardware.',
  };
  const TYPE_ROWS = {
    'http-push': ['token'],
    'zk-tcp': ['host', 'port', 'pass', 'poll'],
    'keyboard-wedge': ['token'],
    simulator: ['sim'],
  };
  const TYPE_STEPS = {
    'http-push': [
      'Give the device a name (e.g. "Reception iClock").',
      'Set a shared token if you want the endpoint to reject unauthenticated pushes.',
      'Press <b>ADD DEVICE</b>, then copy the HTTPS endpoint shown on its configured-device card.',
      'On the terminal: open <b>Comm → ADMS</b>, paste that endpoint as the server URL, and enable push.',
      'Scan a finger on the device — the punch appears in the Live stream within a second.',
    ],
    'zk-tcp': [
      'Give the device a name and type its <b>IP address</b> (e.g. 192.168.1.50).',
      'Keep port <b>4370</b> and poll interval <b>15s</b>. Set the device password if the device has one (0 = none).',
      'Run this Node.js app on the same office LAN, then enable PC download/TCP 4370 on the terminal. Remote Hostinger hosting cannot directly see an office private IP.',
      'Press <b>TEST CONNECTION</b> to handshake, then <b>ADD DEVICE</b>.',
      'It polls the device every 15s — new punches stream in automatically.',
    ],
    'keyboard-wedge': [
      'Plug the USB reader into this computer — no driver or network needed.',
      'Press <b>ADD DEVICE</b> (name it, type stays "USB keyboard-wedge").',
      'Press <b>START</b> on its card, then scan a badge/finger on the reader.',
      'The reader types the ID; it is captured instantly and shows in the Live stream.',
    ],
    simulator: [
      'No hardware needed — a virtual device for testing and demos.',
      'Pick "Auto" (a punch every 8s) or "Manual".',
      'Press <b>ADD DEVICE</b>, then use <b>SIMULATE PUNCH</b> to fire a punch manually.',
      'Use it to try the enrollment flow before connecting real hardware.',
    ],
  };

  $('btnBack').addEventListener('click', () => api.navigate('launcher.html'));

  // wizard field visibility + per-type hint + step guide
  function applyType() {
    const t = $('fType').value;
    ['rowHost', 'rowPort', 'rowPass', 'rowPoll', 'rowToken', 'rowSim'].forEach((r) => { $(r).style.display = 'none'; });
    (TYPE_ROWS[t] || []).forEach((r) => { $('row' + r.charAt(0).toUpperCase() + r.slice(1)).style.display = ''; });
    $('fHint').textContent = TYPE_HINT[t] || '';
    if (t === 'zk-tcp') { $('fPort').value = '4370'; $('fPoll').value = '15'; }
    renderGuide(t);
  }
  $('fType').addEventListener('change', applyType);
  applyType();

  function renderGuide(t) {
    const steps = TYPE_STEPS[t] || [];
    $('guideSteps').innerHTML = steps.map((s) => '<li>' + s + '</li>').join('');
  }

  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('fType').value;
    const cfg = { name: $('fName').value.trim() || TYPE_LABEL[t] };
    if (t === 'http-push') cfg.config = { token: $('fToken').value.trim() || '' };
    if (t === 'zk-tcp') cfg.config = { host: $('fHost').value.trim(), port: Number($('fPort').value) || 4370, password: Number($('fPass').value) || 0, pollIntervalSec: Number($('fPoll').value) || 15 };
    if (t === 'keyboard-wedge') cfg.config = { token: $('fToken').value.trim() || '' };
    if (t === 'simulator') cfg.config = { mode: $('fSimMode').value };
    try {
      await api.devices.add({ name: cfg.name, type: t, config: cfg.config });
      const dev = (await api.devices.list()).find((d) => d.name === cfg.name);
      if (dev) await api.devices.start(dev.id).catch(() => {});
      msg('Device added' + (t === 'zk-tcp' && !$('fHost').value.trim() ? ' — add the IP in its card to connect' : ''), true);
      $('addForm').reset();
      applyType();
      refresh();
    } catch (err) { msg(String(err.message || err), false); }
  });

  $('btnTestWiz').addEventListener('click', async () => {
    const t = $('fType').value;
    if (t === 'http-push') {
      msg('Add the device, then use the HTTPS push endpoint shown on its card. A GET request to that endpoint returns OK.', true);
      return;
    }
    if (t === 'keyboard-wedge') { msg('Wedge readers have no handshake — add, START, then scan a badge.', true); return; }
    if (t === 'simulator') { msg('Simulator needs no test — add it and press SIMULATE PUNCH.', true); return; }
    const host = $('fHost').value.trim();
    if (!host) { msg('Enter the device IP first.', false); return; }
    msg('Testing TCP ' + host + ':' + ($('fPort').value || 4370) + ' …', true);
    try {
      const tmp = await api.devices.add({ name: 'test-probe', type: 'zk-tcp', config: { host, port: Number($('fPort').value) || 4370, password: Number($('fPass').value) || 0, pollIntervalSec: 60 } });
      await api.devices.start(tmp.id);
      const r = await api.devices.test(tmp.id);
      await api.devices.stop(tmp.id);
      await api.devices.remove(tmp.id);
      msg('PASS — device answered. Device time: ' + (r && r.deviceTime || 'n/a'), true);
    } catch (err) {
      msg('FAIL — ' + String(err.message || err) + '. Check IP, subnet, port 4370 and that the device has PC comm enabled.', false);
    }
  });

  $('btnScan').addEventListener('click', async () => {
    const btn = $('btnScan');
    const prev = btn.textContent;
    btn.textContent = 'SCANNING…';
    btn.disabled = true;
    const res = $('scanResults');
    res.innerHTML = '<div class="scan-note">Probing the local network for fingerprint / time-clock devices (ZK TCP 4370 + HTTP 80/8080/8090)…</div>';
    try {
      const found = await api.devices.scanNetwork();
      if (!found || !found.length) {
        res.innerHTML = '<div class="scan-note none">No fingerprint device found. Check the device is powered on and on the same network (same Wi-Fi/LAN). If it uses ADMS, it will appear when its web/HTTP port is reachable.</div>';
      } else {
        res.innerHTML = '';
        for (const d of found) {
          const el = document.createElement('div');
          el.className = 'scan-item';
          const extra = [];
          if (d.deviceTime) extra.push('time ' + new Date(d.deviceTime).toLocaleTimeString());
          if (d.model) extra.push(esc(d.model));
          if (d.title) extra.push(esc(d.title));
          el.innerHTML =
            '<div class="scan-info"><span class="scan-dot"></span>' +
            '<div><div class="scan-name">' + esc(d.vendor || 'Device') + ' <span class="scan-type">' + (d.type === 'zk-tcp' ? 'ZK TCP' : 'HTTP/ADMS') + '</span></div>' +
            '<div class="scan-meta">' + esc(d.ip) + ' : ' + d.port + (extra.length ? ' · ' + extra.join(' · ') : '') + '</div></div></div>' +
            '<button class="scan-add" data-ip="' + esc(d.ip) + '" data-port="' + d.port + '" data-type="' + d.type + '" data-vendor="' + esc(d.vendor || 'Device') + '">ADD</button>';
          res.appendChild(el);
        }
        res.querySelectorAll('.scan-add').forEach((b) => {
          b.addEventListener('click', () => {
            const t = b.dataset.type === 'zk-tcp' ? 'zk-tcp' : 'http-push';
            $('fType').value = t;
            applyType();
            if (t === 'zk-tcp') { $('fHost').value = b.dataset.ip; $('fPort').value = b.dataset.port || '4370'; }
            $('fName').value = (b.dataset.vendor || 'Device') + ' ' + b.dataset.ip;
            msg('Pre-filled the wizard — press ADD DEVICE to connect ' + b.dataset.ip + '.', true);
            $('fName').focus();
          });
        });
      }
    } catch (err) {
      res.innerHTML = '<div class="scan-note none">Scan failed: ' + esc(String(err.message || err)) + '</div>';
    } finally {
      btn.textContent = prev;
      btn.disabled = false;
    }
  });

  $('btnSimulate').addEventListener('click', async () => {
    const p = await api.devices.simulatePunch(null, 0);
    if (p) msg('Simulated punch for employee ' + p.employeeId + ' @ ' + new Date(p.ts).toLocaleTimeString(), true);
  });

  $('btnImport').addEventListener('click', async () => {
    const p = await api.openFile({ filters: [{ name: 'Attendance files (TXT/CSV/DAT)', extensions: ['txt', 'csv', 'dat'] }] });
    if (!p) return;
    try {
      const r = await api.devices.importFile(p, null);
      msg('Imported ' + r.imported + ' records from ' + String(p).split(/[\\/]/).pop() + '.', true);
    } catch (err) { msg('Import failed: ' + String(err.message || err), false); }
  });

  // ---- people enrollment ----
  $('btnNewPerson').addEventListener('click', () => openEnroll('', ''));
  $('btnEnrollCancel').addEventListener('click', closeEnroll);

  function openEnroll(id, hint) {
    $('enrollCard').style.display = '';
    $('eId').value = id || '';
    $('eName').value = '';
    $('eDept').value = '';
    $('enrollTitle').textContent = hint ? 'New fingerprint detected — register this person' : 'Register a person';
    $('enrollHint').textContent = hint || '';
    if (id) $('eId').setAttribute('readonly', 'readonly');
    else $('eId').removeAttribute('readonly');
    $('eName').focus();
  }
  function closeEnroll() { $('enrollCard').style.display = 'none'; }

  $('enrollForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('eId').value.trim();
    const name = $('eName').value.trim();
    const dept = $('eDept').value.trim();
    if (!id || !name) { msg('Both the ID and the name are required.', false); return; }
    try {
      await api.people.register(id, { name, department: dept });
      msg('Registered "' + name + '" for ID ' + id + '.', true);
      closeEnroll();
      await refresh();
    } catch (err) { msg(String(err.message || err), false); }
  });

  function msg(text, ok) {
    const el = $('wizMsg');
    el.textContent = text;
    el.className = 'wiz-msg ' + (ok ? 'ok' : 'err');
  }

  function renderDevices() {
    const list = $('deviceList');
    if (!state.devices.length) {
      list.innerHTML = '<div class="empty">No devices configured yet. Use the wizard on the right →</div>';
      return;
    }
    list.innerHTML = '';
    for (const d of state.devices) {
      const el = document.createElement('div');
      el.className = 'device';
      const metaBits = [];
      if (d.config && d.config.host) metaBits.push(d.config.host + ':' + (d.config.port || 4370));
      if (d.config && d.config.port && !d.config.host) metaBits.push(':' + d.config.port);
      if (d.type === 'http-push') metaBits.push(location.origin + '/api/device-push/' + d.id);
      if (d.lastPollAt) metaBits.push('last poll ' + new Date(d.lastPollAt).toLocaleTimeString());
      el.innerHTML =
        '<div class="drow"><span class="dstatus ' + (d.status || 'stopped') + '"></span>' +
        '<div><div class="dname">' + esc(d.name) + '</div><div class="dtype">' + (TYPE_LABEL[d.type] || d.type) + '</div></div>' +
        '<div class="dactions">' +
        (d.status === 'running'
          ? '<button data-act="stop" data-id="' + d.id + '">STOP</button>'
          : '<button data-act="start" data-id="' + d.id + '">START</button>') +
        '<button data-act="test" data-id="' + d.id + '">TEST</button>' +
        '<button data-act="remove" data-id="' + d.id + '" class="danger">REMOVE</button>' +
        '</div></div>' +
        (d.lastError ? '<div class="derr">⚠ ' + esc(d.lastError) + '</div>' : '') +
        (metaBits.length ? '<div class="dmeta">' + esc(metaBits.join(' · ')) + '</div>' : '');
      list.appendChild(el);
    }
    list.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        try {
          if (act === 'start') await api.devices.start(id);
          if (act === 'stop') await api.devices.stop(id);
          if (act === 'remove') { await api.devices.stop(id); await api.devices.remove(id); }
          if (act === 'test') {
            const r = await api.devices.test(id);
            msg('PASS — ' + (r && r.deviceTime ? 'device time ' + r.deviceTime : 'connector responded'), true);
          }
        } catch (err) { msg(String(err.message || err), false); }
        refresh();
      });
    });
  }

  function renderPeople() {
    const list = $('peopleList');
    const dl = $('deptList');
    if (!state.people.length) {
      list.innerHTML = '<div class="empty">No one registered yet. Scan a fingerprint or press "Register a person".</div>';
      dl.innerHTML = '';
      return;
    }
    list.innerHTML = '';
    const depts = new Set();
    for (const p of state.people) {
      if (p.department) depts.add(p.department);
      const el = document.createElement('div');
      el.className = 'person';
      const seen = p.lastSeen ? ' · last seen ' + new Date(p.lastSeen).toLocaleString() : '';
      el.innerHTML =
        '<div class="prow">' +
        '<div class="pavatar">' + esc(initials(p.name)) + '</div>' +
        '<div><div class="pname">' + esc(p.name) + '</div>' +
        '<div class="pmeta">ID ' + esc(p.employeeId) + (p.department ? ' · ' + esc(p.department) : '') + seen + '</div></div>' +
        '<button data-rid="' + esc(p.employeeId) + '" class="danger pdel">REMOVE</button>' +
        '</div>';
      list.appendChild(el);
    }
    dl.innerHTML = [...depts].map((d) => '<option value="' + esc(d) + '"></option>').join('');
    list.querySelectorAll('[data-rid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api.people.remove(btn.dataset.rid);
        msg('Removed ID ' + btn.dataset.rid + '.', true);
        refresh();
      });
    });
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] || parts[0] || '?')[0]).toUpperCase();
  }

  function renderStream(evt) {
    const el = $('punchStream');
    if (el.querySelector('.empty')) el.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'punch' + (evt.registered ? ' reg' : ' unreg');
    const who = evt.name ? esc(evt.name) : 'ID ' + esc(evt.employeeId) + ' <span class="punreg">unregistered</span>';
    row.innerHTML = '<span class="pt">' + new Date(evt.ts).toLocaleTimeString() + '</span>' +
      '<span class="pid">' + who + '</span>' +
      '<span class="pdev">' + esc(evt.deviceName || evt.connector) + '</span>';
    el.prepend(row);
    while (el.children.length > 60) el.lastChild.remove();
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function refresh() {
    state.devices = await api.devices.list();
    state.people = await api.people.list();
    renderDevices();
    renderPeople();
    const running = state.devices.filter((d) => d.status === 'running').length;
    $('dCount').textContent = state.devices.length;
    $('dRunning').textContent = running;
    $('dPeople').textContent = state.people.length;
    $('streamState').textContent = running ? 'STREAMING' : 'STOPPED';
  }

  api.devices.onEvent((evt) => {
    if (evt.kind === 'punch') {
      renderStream(evt);
      $('dLast').textContent = (evt.name || evt.employeeId) + ' @ ' + new Date(evt.ts).toLocaleTimeString();
      if (!evt.registered && evt.employeeId) {
        openEnroll(evt.employeeId, 'Fingerprint ID ' + esc(evt.employeeId) + ' scanned but not registered yet.');
      }
      refresh();
    }
  });

  refresh().catch((e) => console.error(e));
})();
