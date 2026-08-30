// launcher.js — shell landing page logic
(function () {
  const api = window.desktopApi;

  function openPage(page) {
    api.navigate(page).catch((e) => console.error('navigate failed', e));
  }

  document.querySelectorAll('.open').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openPage(btn.dataset.page); });
  });
  document.querySelectorAll('.app-card').forEach((card) => {
    card.addEventListener('click', () => openPage(card.querySelector('.open').dataset.page));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPage(card.querySelector('.open').dataset.page); } });
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '1') openPage('seo-for-all/index.html');
    if (e.key === '2') openPage('devices.html');
  });

  document.getElementById('btnDataFolder').addEventListener('click', () => api.openDataFolder());

  const btnConfig = document.getElementById('btnConfig');
  btnConfig.addEventListener('click', () => openPage('setup.html?mode=manage'));
  const btnCoConfig = document.getElementById('btnCoConfig');
  btnCoConfig.addEventListener('click', () => openPage('setup.html?mode=manage'));
  document.getElementById('btnRunSetup').addEventListener('click', () => openPage('setup.html'));

  async function loadCompany() {
    const cfg = await api.company.get();
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setHtml = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
    const strip = document.getElementById('companyStrip');
    const warn = document.getElementById('warnStrip');
    if (!cfg) {
      if (strip) strip.style.display = 'none';
      if (warn) warn.style.display = 'flex';
      btnConfig.textContent = '⚙ SETUP';
      setText('stripStatus', 'Setup required');
      setText('stripDetail', 'run the configuration wizard first');
      return;
    }
    if (warn) warn.style.display = 'none';
    if (strip) strip.style.display = 'flex';
    btnConfig.textContent = '⚙ CONFIGURATION';
    setText('coName', cfg.companyName || '—');
    setText('coTag', (cfg.tagline || '') + (cfg.country ? ' · ' + cfg.country : ''));
    const logo = document.getElementById('coLogo');
    if (logo) {
      if (cfg.logo) logo.innerHTML = '<img src="/company-logo/' + encodeURIComponent(cfg.logo) + '" alt="logo">';
      else logo.innerHTML = '<span>NO<br>LOGO</span>';
    }
    const roleLabel = { ceo: 'Owner / CEO', director: 'Director', manager: 'Manager', lead: 'Team Lead', employee: 'Employee' };
    setText('coRole', roleLabel[cfg.registeredAs] || cfg.registeredAs);
    setText('coOwner', (cfg.owner ? cfg.owner.name + ' · ' + cfg.owner.employeeId : '—'));
    setText('coEmps', (cfg.employees ? cfg.employees.length : 0) + ' registered');
    setHtml('coNameTop', (cfg.companyName || 'SEO FOR ALL') + ' <b>OS</b>');
    setText('coTagTop', cfg.tagline || 'Company Intelligence OS');
    document.title = cfg.companyName + ' — SEO For All OS';
    const devs = await api.devices.list().catch(() => []);
    setText('coDevs', devs.length + ' devices');
  }

  document.getElementById('btnAudit').addEventListener('click', async () => {
    const rows = await api.auditRead(300);
    const text = rows.map((r) => `[${r.ts}] ${r.action} :: ${r.target} ${r.detail ? JSON.stringify(r.detail) : ''}`).join('\n');
    const p = await api.saveFile({ defaultPath: 'audit-log.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (p) await api.writeFile(p, text, false);
  });

  document.getElementById('btnDocs').addEventListener('click', () => {
    api.auditLog('ui.open-docs', 'USER-GUIDE.md', {});
    api.openDocs();
  });

  async function refresh() {
    const info = await api.getInfo();
    document.getElementById('verChip').textContent = 'v' + info.version;
    document.getElementById('footVer').textContent = info.version;
    document.getElementById('footElectron').textContent = info.runtime || ('Node.js ' + info.node);
    document.getElementById('footChrome').textContent = 'WEB APP';
    document.getElementById('dataFolder').textContent = info.userData;
    document.getElementById('roStorage').textContent = 'LOCAL';

    const projects = await api.listProjects();
    document.getElementById('roProjects').textContent = String(projects.length).padStart(2, '0');

    const audit = await api.auditRead(10000);
    document.getElementById('roAudit').textContent = String(audit.length).padStart(2, '0');

    const devices = await api.devices.list();
    document.getElementById('devCount').textContent = devices.length + ' DEVICE' + (devices.length === 1 ? '' : 'S');
    const running = devices.filter((d) => d.status === 'running').length;
    document.getElementById('stripStatus').textContent = running ? running + ' device(s) streaming' : 'Shell ready — no device streaming';
    document.getElementById('stripDetail').textContent = devices.length + ' configured · server-side persistence active';

    const punches = await api.auditRead(100000);
    const p = punches.filter((r) => r.action === 'device.punch').length;
    document.getElementById('roPunches').textContent = String(p).padStart(2, '0');
  }

  api.devices.onEvent(() => { /* status may change */ setTimeout(refresh, 800); });
  refresh().catch((e) => { document.getElementById('stripStatus').textContent = 'Shell error: ' + e.message; });
  loadCompany().catch((e) => console.error('company load failed', e));
})();
