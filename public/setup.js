/* setup.js — first-run wizard + configuration center (manage mode) */
const $ = (id) => document.getElementById(id);
const api = window.desktopApi;

const MODE = new URLSearchParams(location.search).get('mode');
const isManage = MODE === 'manage';
let cfg = null;           // current company config
let logoFile = null;      // chosen logo filename
let devices = [];         // device list from hub
const STEP_KEYS = ['company', 'registration', 'departments', 'employees', 'devices', 'prefs', 'summary'];

const ROLES = ['ceo', 'director', 'manager', 'lead', 'employee'];
const ROLE_LABEL = { ceo: 'Owner / CEO', director: 'Director', manager: 'Manager', lead: 'Team Lead', employee: 'Employee' };
const WEEKDAYS = [
  ['sun', 'Sun'], ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'],
  ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'],
];
const DEV_TYPES = { 'http-push': 'HTTP push', 'zk-tcp': 'ZK TCP', 'keyboard-wedge': 'Keyboard wedge', 'simulator': 'Simulator' };

let state = {
  step: 0,
  companyName: '', tagline: '', country: '', timezone: 'Africa/Cairo', currency: 'EGP', logo: null,
  registeredAs: 'ceo', owner: { name: '', employeeId: '1001', role: 'ceo', department: '' },
  departments: ['Management', 'Marketing', 'IT', 'Finance', 'Sales', 'Design', 'HR'],
  employees: [],   // {name, employeeId, department, role, deviceId}
  devices: [],     // quick-added devices
  prefs: { workHours: 8, weekdays: ['sun', 'mon', 'tue', 'wed', 'thu'], autoBackup: false, backupPath: '', reminders: true, funEnabled: true, keepDemoRecords: true },
};

/* ---------- boot ---------- */
async function boot() {
  document.title = isManage ? 'Configuration Center' : 'System Setup';
  $('hdrTitle').innerHTML = isManage ? 'CONFIGURATION <b>CENTER</b>' : 'SYSTEM <b>SETUP</b>';
  $('hdrSub').textContent = isManage ? 'Manage every setting of your installation' : 'Configure everything before you start';
  $('modeChip').textContent = isManage ? 'MANAGE MODE' : 'FIRST RUN';
  if (isManage) $('btnBack').style.display = '';
  $('btnBack').onclick = () => api.navigate('launcher.html');
  if (isManage) $('saveBar').style.display = 'flex';

  cfg = await api.company.get();
  const prev = cfg || {};
  logoFile = prev.logo || null;
  if (prev.companyName) {
    state.companyName = prev.companyName; state.tagline = prev.tagline || 'Company Intelligence OS';
    state.country = prev.country || ''; state.timezone = prev.timezone || 'Africa/Cairo'; state.currency = prev.currency || 'EGP';
    state.registeredAs = prev.registeredAs || 'ceo';
    state.owner = prev.owner || state.owner;
    if (prev.departments && prev.departments.length) state.departments = prev.departments;
    if (prev.employees) state.employees = prev.employees.map(e => ({ ...e }));
    state.prefs = { ...state.prefs, ...(prev.preferences || {}) };
  }
  // carry devices from the device hub so the wizard reflects reality
  try { devices = (await api.devices.list()) || []; } catch (_) { devices = []; }

  buildStepBar();
  fillCompany();
  fillRegistration();
  renderDepts();
  renderEmployees();
  renderDevices();
  fillPrefs();
  wireNav();
  showStep(0);
  if (isManage) msg('Loaded from company/config.json — edit and save.', 'ok');
}

/* ---------- step bar ---------- */
function buildStepBar() {
  const labels = ['Company', 'Registration', 'Departments', 'Employees', 'Devices', 'Preferences', 'Review'];
  $('steps').innerHTML = labels.map((l, i) => `<div class="st" id="st${i}" title="${l}"></div>`).join('');
}
function showStep(i) {
  state.step = i;
  document.querySelectorAll('.spane').forEach((s) => s.classList.remove('active'));
  $('step-' + i).classList.add('active');
  document.querySelectorAll('.st').forEach((s) => s.classList.remove('on', 'now'));
  for (let k = 0; k < i; k++) $('st' + k).classList.add('on');
  $('st' + i).classList.add('now');
  if (i === 6) renderSummary();
  window.scrollTo({ top: 0 });
}

/* ---------- step 0: company ---------- */
function fillCompany() {
  $('fCompanyName').value = state.companyName;
  $('fTagline').value = state.tagline;
  $('fCountry').value = state.country;
  $('fTimezone').value = state.timezone;
  $('fCurrency').value = state.currency;
  renderLogo();
}
function renderLogo() {
  const p = $('logoPreview');
  if (logoFile) {
    p.innerHTML = `<img src="/company-logo/${encodeURIComponent(logoFile)}" alt="logo">`;
  } else {
    p.innerHTML = '<span>NO LOGO</span>';
  }
}
$('btnLogo') && ($('btnLogo').onclick = async () => {
  const name = await api.company.chooseLogo();
  if (name) { logoFile = name; renderLogo(); msg('Logo stored: ' + name, 'ok'); }
});
$('btnLogoClear') && ($('btnLogoClear').onclick = () => { logoFile = null; renderLogo(); });

/* ---------- step 1: registration ---------- */
function fillRegistration() {
  const radios = document.querySelectorAll('input[name="regRole"]');
  radios.forEach((r) => { r.checked = r.value === state.registeredAs; });
  $('fOwnerName').value = state.owner.name;
  $('fOwnerId').value = state.owner.employeeId;
  const sel = $('fOwnerDept');
  sel.innerHTML = state.departments.map((d) => `<option>${d}</option>`).join('');
  sel.value = state.owner.department || state.departments[0];
}
document.querySelectorAll('input[name="regRole"]').forEach((r) => r.addEventListener('change', () => {
  state.registeredAs = document.querySelector('input[name="regRole"]:checked').value;
}));

/* ---------- step 2: departments ---------- */
function renderDepts() {
  $('deptChips').innerHTML = state.departments.map((d, i) =>
    `<span class="chip-item">${d}<button title="remove" data-i="${i}">✕</button></span>`).join('');
  $('deptChips').querySelectorAll('button').forEach((b) => b.onclick = () => {
    state.departments.splice(+b.dataset.i, 1);
    if (!state.departments.length) state.departments = ['General'];
    renderDepts(); fillRegistration();
  });
  // keep owner dept select in sync
  const sel = $('fOwnerDept');
  if (sel) { sel.innerHTML = state.departments.map((d) => `<option>${d}</option>`).join(''); }
}
$('btnAddDept') && ($('btnAddDept').onclick = () => {
  const v = $('fNewDept').value.trim();
  if (v && !state.departments.includes(v)) { state.departments.push(v); $('fNewDept').value = ''; renderDepts(); fillRegistration(); }
});

/* ---------- step 3: employees ---------- */
const EMP_ROWS = () => state.employees;
function renderEmployees() {
  const tb = $('empRows');
  if (!state.employees.length) {
    tb.innerHTML = `<tr><td colspan="6" style="color:#5f6a79;font-size:11px;text-align:center;padding:16px">No employees yet — add the roster, or load the demo roster.</td></tr>`;
    return;
  }
  tb.innerHTML = state.employees.map((e, i) => `
    <tr data-i="${i}">
      <td><input class="e-name" value="${esc(e.name)}"></td>
      <td><input class="e-id" value="${esc(e.employeeId)}"></td>
      <td><select class="e-dept">${state.departments.map((d) => `<option ${d === e.department ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
      <td><select class="e-role">${ROLES.map((r) => `<option value="${r}" ${r === e.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></td>
      <td><input class="e-dev" value="${esc(e.deviceId || '')}"></td>
      <td><button class="del" title="remove" data-i="${i}">✕</button></td>
    </tr>`).join('');
  tb.querySelectorAll('.del').forEach((b) => b.onclick = () => { state.employees.splice(+b.dataset.i, 1); renderEmployees(); });
  tb.querySelectorAll('.e-name').forEach((n) => n.oninput = (ev) => state.employees[+ev.target.closest('tr').dataset.i].name = ev.target.value);
  tb.querySelectorAll('.e-id').forEach((n) => n.oninput = (ev) => state.employees[+ev.target.closest('tr').dataset.i].employeeId = ev.target.value);
  tb.querySelectorAll('.e-dev').forEach((n) => n.oninput = (ev) => state.employees[+ev.target.closest('tr').dataset.i].deviceId = ev.target.value);
  tb.querySelectorAll('.e-dept').forEach((n) => n.onchange = (ev) => state.employees[+ev.target.closest('tr').dataset.i].department = ev.target.value);
  tb.querySelectorAll('.e-role').forEach((n) => n.onchange = (ev) => state.employees[+ev.target.closest('tr').dataset.i].role = ev.target.value);
}
function addEmpRow(emp) {
  state.employees.push(emp || { name: '', employeeId: '', department: state.departments[0] || 'General', role: 'employee', deviceId: '' });
  renderEmployees();
}
$('btnAddEmp') && ($('btnAddEmp').onclick = () => addEmpRow());
$('btnClearEmp') && ($('btnClearEmp').onclick = () => { state.employees = []; renderEmployees(); });
$('btnFillDemo') && ($('btnFillDemo').onclick = () => {
  state.employees = [
    { name: state.owner.name || 'Owner', employeeId: state.owner.employeeId || '1001', department: state.owner.department || 'Management', role: state.registeredAs, deviceId: '' },
    { name: 'Sarah Adel', employeeId: '1002', department: 'Marketing', role: 'manager', deviceId: '' },
    { name: 'Youssef Salem', employeeId: '1003', department: 'IT', role: 'lead', deviceId: '' },
    { name: 'Ahmed Nabil', employeeId: '1004', department: 'Design', role: 'employee', deviceId: '' },
    { name: 'Mona Hassan', employeeId: '1005', department: 'Finance', role: 'employee', deviceId: '' },
  ];
  renderEmployees();
});

/* ---------- step 4: devices ---------- */
function devFieldVisibility() {
  const t = $('fDevType').value;
  $('devRowHost').style.display = (t === 'zk-tcp' || t === 'keyboard-wedge') ? '' : 'none';
  $('devRowPort').style.display = t === 'zk-tcp' ? '' : 'none';
  $('devRowToken').style.display = t === 'http-push' ? '' : 'none';
}
$('fDevType') && ($('fDevType').onchange = devFieldVisibility);
function renderDevices() {
  const all = [...devices];
  const el = $('setupDevList');
  if (!all.length) { el.innerHTML = '<div class="empty">No devices configured yet — add one below or skip (Devices Hub is always available).</div>'; return; }
  el.innerHTML = all.map((d, i) => `
    <div class="setup-dev"><span class="dot"></span>
      <b>${esc(d.name)}</b> · ${DEV_TYPES[d.type] || d.type} · ${esc((d.config && (d.config.host || d.config.port)) || 'web/server')}
      <button data-i="${i}">REMOVE</button></div>`).join('');
  el.querySelectorAll('button').forEach((b) => b.onclick = async () => {
    await api.devices.remove(devices[b.dataset.i].id);
    devices.splice(b.dataset.i, 1); renderDevices(); msg('Device removed.', 'ok');
  });
}
$('btnAddDev') && ($('btnAddDev').onclick = async () => {
  const type = $('fDevType').value;
  const name = $('fDevName').value.trim() || (DEV_TYPES[type] + ' terminal');
  const dev = { name, type, config: {} };
  if (type === 'zk-tcp') { dev.config.host = $('fDevHost').value.trim(); dev.config.port = +$('fDevPort').value || 4370; dev.config.password = $('fDevToken').value.trim(); }
  if (type === 'http-push') { dev.config.token = $('fDevToken').value.trim(); }
  if (type === 'keyboard-wedge') { dev.config.host = $('fDevHost').value.trim() || 'local'; }
  try {
    const saved = await api.devices.add(dev);
    devices.push(saved); renderDevices(); msg('Device added: ' + saved.name + ' — open Devices Hub to start it.', 'ok');
    $('fDevName').value = '';
  } catch (e) { msg('Failed: ' + e.message, 'err'); }
});
$('btnTestDev') && ($('btnTestDev').onclick = async () => {
  msg('Testing connection…');
  let tempId = null;
  try {
    const type = $('fDevType').value;
    const dev = { name: 'Temporary connection test', type, config: {} };
    if (type === 'zk-tcp') { dev.config.host = $('fDevHost').value.trim() || '192.168.1.50'; dev.config.port = +$('fDevPort').value || 4370; dev.config.password = $('fDevToken').value.trim(); }
    if (type === 'http-push') dev.config.token = $('fDevToken').value.trim();
    if (type === 'simulator') dev.config.mode = 'manual';
    const saved = await api.devices.add(dev);
    tempId = saved.id;
    const r = await api.devices.test(tempId);
    msg(r.ok ? 'TEST OK — ' + (r.detail || r.note || 'connection works') : 'TEST FAILED — ' + (r.detail || 'no response'), r.ok ? 'ok' : 'err');
  } catch (e) { msg('TEST ERROR — ' + e.message, 'err'); }
  finally { if (tempId) await api.devices.remove(tempId).catch(() => {}); }
});

/* ---------- step 5: preferences ---------- */
function fillPrefs() {
  $('fWorkHours').value = state.prefs.workHours;
  $('weekdayChips').innerHTML = WEEKDAYS.map(([v, l]) =>
    `<label class="day-chip"><input type="checkbox" value="${v}" ${state.prefs.weekdays.includes(v) ? 'checked' : ''}><span>${l}</span></label>`).join('');
  $('fAutoBackup').checked = state.prefs.autoBackup;
  $('fBackupPath').value = state.prefs.backupPath || '';
  $('fReminders').checked = state.prefs.reminders;
  $('fFun').checked = state.prefs.funEnabled;
  $('fKeepDemo').checked = state.prefs.keepDemoRecords;
  $('rowBackupPath').style.display = state.prefs.autoBackup ? '' : 'none';
  $('fAutoBackup').onchange = () => { $('rowBackupPath').style.display = $('fAutoBackup').checked ? '' : 'none'; };
}
$('btnPickBackup') && ($('btnPickBackup').onclick = async () => {
  const p = await api.pickFolder();
  if (p) $('fBackupPath').value = p;
});

/* ---------- step 6: summary ---------- */
function renderSummary() {
  const o = state.owner;
  const cards = [
    ['Company', `<b>${state.companyName || '—'}</b><br><small>${state.tagline || ''} · ${state.country || '?'} · ${state.timezone} · ${state.currency}</small>`],
    ['Registered as', `<b>${ROLE_LABEL[state.registeredAs]}</b><br><small>${o.name || '—'} · ID ${o.employeeId || '—'} · ${o.department || '—'}</small>`],
    ['Departments', state.departments.join(', ')],
    ['Employees', `${state.employees.length} registered (incl. owner)`],
    ['Fingerprint devices', devices.length ? devices.map((d) => `${d.name} (${DEV_TYPES[d.type] || d.type})`).join('<br>') : 'None yet — add later in Devices Hub'],
    ['Rules', `Work day ${state.prefs.workHours}h · ${state.prefs.weekdays.length} days/wk · Backup ${state.prefs.autoBackup ? 'ON' : 'OFF'} · Demo records ${state.prefs.keepDemoRecords ? 'kept' : 'cleared'}`],
  ];
  $('summaryCards').innerHTML = cards.map(([k, v]) => `<div class="sum-card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
}

/* ---------- save ---------- */
function collect() {
  state.companyName = $('fCompanyName').value.trim();
  state.tagline = $('fTagline').value.trim();
  state.country = $('fCountry').value.trim();
  state.timezone = $('fTimezone').value;
  state.currency = $('fCurrency').value;
  state.owner = {
    name: $('fOwnerName').value.trim(),
    employeeId: $('fOwnerId').value.trim() || '1001',
    role: state.registeredAs,
    department: $('fOwnerDept').value,
  };
  state.prefs.workHours = +$('fWorkHours').value || 8;
  state.prefs.weekdays = [...document.querySelectorAll('#weekdayChips input:checked')].map((i) => i.value);
  if (!state.prefs.weekdays.length) state.prefs.weekdays = ['sun', 'mon', 'tue', 'wed', 'thu'];
  state.prefs.autoBackup = $('fAutoBackup').checked;
  state.prefs.backupPath = $('fBackupPath').value.trim();
  state.prefs.reminders = $('fReminders').checked;
  state.prefs.funEnabled = $('fFun').checked;
  state.prefs.keepDemoRecords = $('fKeepDemo').checked;
}
async function saveAll() {
  collect();
  if (!state.companyName) { msg('Company name is required.', 'err'); showStep(0); return false; }
  if (!state.owner.name) { msg('The registering person needs a name.', 'err'); showStep(1); return false; }
  const payload = {
    companyName: state.companyName, tagline: state.tagline, logo: logoFile,
    timezone: state.timezone, country: state.country, currency: state.currency,
    registeredAs: state.registeredAs, owner: state.owner,
    departments: state.departments, employees: state.employees,
    preferences: state.prefs,
  };
  const saved = await api.company.save(payload);
  cfg = saved;
  if (state.prefs.autoBackup) {
    try {
      await api.openDataFolder();
      msg('Configuration saved ✓ · server backup downloaded', 'ok');
    } catch (error) {
      msg('Configuration saved ✓ · automatic backup failed: ' + error.message, 'err');
    }
  } else {
    msg('Configuration saved to company/config.json ✓', 'ok');
  }
  return true;
}

/* ---------- nav wiring ---------- */
function wireNav() {
  const pairs = [[0, 's0Back', 's0Next'], [1, 's1Back', 's1Next'], [2, 's2Back', 's2Next'], [3, 's3Back', 's3Next'], [4, 's4Back', 's4Next'], [5, 's5Back', 's5Next'], [6, 's6Back', 'btnFinish']];
  for (const [i, backId, nextId] of pairs) {
    $('s' + i + 'Back') && ($('s' + i + 'Back').onclick = () => { collect(); showStep(i - 1); });
    $('s' + i + 'Next') && ($('s' + i + 'Next').onclick = () => { collect(); showStep(i + 1); });
  }
  $('btnFinish').onclick = async () => {
    if (await saveAll()) {
      if (isManage) { showStep(0); msg('Saved — changes are live in the apps.', 'ok'); }
      else {
        msg('Configuration complete — launching your workspace…', 'ok');
        setTimeout(() => api.navigate('launcher.html'), 700);
      }
    }
  };
  $('btnSaveAll') && ($('btnSaveAll').onclick = async () => {
    if (await saveAll()) msg('Saved — changes are live in the apps.', 'ok');
  });
  $('btnResetCfg') && ($('btnResetCfg').onclick = async () => {
    if (!confirm('Reset company configuration to demo state? Your device list stays.')) return;
    const r = await api.company.reset();
    if (r && r.ok) { msg('Configuration reset — the app will reopen the setup wizard.', 'ok'); setTimeout(() => api.navigate('setup.html'), 700); }
    else msg('Reset failed: ' + (r && r.error), 'err');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
      const next = $('s' + state.step + 'Next');
      if (next) next.click();
    }
  });
}

function msg(t, kind) {
  const el = $('wizMsg');
  el.textContent = t;
  el.className = 'wiz-msg ' + (kind || '');
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

window.addEventListener('DOMContentLoaded', boot);
