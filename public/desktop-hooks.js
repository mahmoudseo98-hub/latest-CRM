// desktop-hooks.js — shared compatibility hooks for Electron and the Node.js web bridge.
(function () {
  const api = window.desktopApi;
  if (!api) return;

  const isAtelier = location.pathname.indexOf('atelier') >= 0;
  const isSeo = location.pathname.indexOf('seo-for-all') >= 0;

  function toast(msg) {
    try { if (typeof window.showToast === 'function') window.showToast(msg); } catch (_) {}
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function bufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }

  function filterFor(filename) {
    const ext = String(filename).split('.').pop().toLowerCase();
    if (ext === 'pdf') return [{ name: 'PDF document', extensions: ['pdf'] }];
    if (ext === 'csv') return [{ name: 'CSV (Excel-compatible)', extensions: ['csv'] }];
    if (ext === 'json') return [{ name: 'JSON backup', extensions: ['json'] }];
    if (ext === 'png') return [{ name: 'PNG image', extensions: ['png'] }];
    return [{ name: 'All files', extensions: ['*'] }];
  }

  async function nativeSave(filename, data, isBase64, bytes) {
    const filePath = await api.saveFile({ defaultPath: filename, filters: filterFor(filename) });
    if (!filePath) return null;
    const r = await api.writeFile(filePath, data, !!isBase64);
    if (r && r.ok) {
      api.auditLog('export.saved', filePath, { bytes: bytes || 0 });
      toast('Saved to ' + String(filePath).split(/[\\/]/).pop());
      return filePath;
    }
    throw new Error((r && r.error) || 'write failed');
  }

  // ---------- 1. Native save dialogs ----------
  if (isSeo) {
    const orig = window.downloadBlob;
    window.downloadBlob = function (content, name, type) {
      try {
        if (typeof content === 'string') {
          nativeSave(name || 'export.csv', content, false, content.length)
            .catch(() => orig && orig(content, name, type));
        } else {
          const p = content instanceof Blob ? content.arrayBuffer() : Promise.resolve(content);
          p.then((buf) => nativeSave(name || 'export.pdf', bufferToBase64(buf), true, buf.byteLength))
            .catch(() => orig && orig(content, name, type));
        }
      } catch (_) { if (orig) orig(content, name, type); }
    };
  }

  if (isAtelier) {
    try {
      if (window.jspdf && window.jspdf.jsPDF) {
        const proto = window.jspdf.jsPDF.prototype;
        const origSave = proto.save;
        proto.save = function (filename, opts) {
          try {
            const buf = this.output('arraybuffer');
            nativeSave(filename || 'atelier-layout.pdf', bufferToBase64(buf), true, buf.byteLength)
              .catch(() => origSave.call(this, filename, opts));
          } catch (_) { origSave.call(this, filename, opts); }
        };
      }
    } catch (_) {}
  }

  // ---------- 1.5 Company branding (SEO OS + titles) ----------
  async function applyCompanyBranding() {
    let cfg = null;
    try { cfg = await api.company.get(); } catch (_) {}
    if (!cfg) return;
    const company = cfg.companyName || 'SEO For All';
    const tagline = cfg.tagline || 'Company Intelligence OS';

    if (isSeo) {
      const b = document.querySelector('.brand-copy b');
      if (b) b.textContent = company;
      const s = document.querySelector('.brand-copy span');
      if (s) s.textContent = tagline;
      const eyebrow = document.querySelector('.seo-dashboard-head .eyebrow');
      if (eyebrow) eyebrow.textContent = company.toUpperCase() + ' · OPERATIONS INTELLIGENCE';
      const title = document.getElementById('dashboardTitle');
      if (title) {
        const h = new Date().getHours();
        const g = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
        const first = (cfg.owner && cfg.owner.name ? cfg.owner.name.split(' ')[0] : 'there');
        title.textContent = g + ', ' + first + ' 👋';
      }
      const sub = document.getElementById('dashboardSubtitle');
      if (sub) sub.textContent = 'Here\u2019s what\u2019s happening with ' + company + ' today.';
      const av = document.querySelector('.avatar');
      if (av && cfg.owner && cfg.owner.name) {
        const parts = cfg.owner.name.trim().split(/\s+/);
        av.textContent = ((parts[0] || '?')[0] + (parts[1] || parts[0] || '?')[0]).toUpperCase();
      }
      if (cfg.logo) {
        document.querySelectorAll('.brand-logo, .topbar-brand-mini img').forEach((img) => {
          img.src = '/company-logo/' + encodeURIComponent(cfg.logo);
          img.style.display = '';
        });
      }
      // registered identity drives the initial role selector
      if (cfg.registeredAs) {
        const rs = document.getElementById('roleSelect');
        if (rs) {
          const opts = [].map.call(rs.options, (o) => o.value);
          if (opts.indexOf(cfg.registeredAs) >= 0) {
            rs.value = cfg.registeredAs;
            try { rs.dispatchEvent(new Event('change')); } catch (_) {}
          }
        }
      }
      // attendance ledger rows from the real roster
      if (cfg.employees && cfg.employees.length) {
        const tb = document.querySelector('#attendanceTable tbody');
        if (tb) {
          const hours = (cfg.preferences && cfg.preferences.workHours) || 8;
          tb.innerHTML = cfg.employees.map((e) => {
            const dept = e.department || 'General';
            return '<tr data-scope="' + String(dept).toLowerCase() + '"><td><b>' + escapeHtml(e.name) + '</b></td><td>' + escapeHtml(dept) +
              '</td><td>' + hours + 'h</td><td class="hours-good">' + hours + '.0h</td><td>0h</td><td>0m</td><td>0</td><td>—</td><td>EGP 0</td><td><span class="badge green">On track</span></td></tr>';
          }).join('');
        }
      }
    }
    document.title = company + ' — ' + (isSeo ? 'Company Intelligence OS v10' : 'Atelier 3D — Commercial Space Planner');
  }
  applyCompanyBranding().catch(() => {});

  // ---------- 2. Device punches -> App A attendance ledger ----------
  const onPunch = (evt) => {
    if (evt.kind !== 'punch' || !evt.employeeId) return;
    if (isSeo) {
      try {
        const tb = document.querySelector('#attendanceTable tbody');
        if (tb) {
          const time = new Date(evt.ts).toLocaleString();
          const tr = document.createElement('tr');
          tr.dataset.scope = 'devices';
          const who = evt.name
            ? '<b>' + escapeHtml(evt.name) + '</b><br><small style="color:var(--muted)">' + escapeHtml(evt.deviceName || 'Fingerprint device') + '</small>'
            : '<b>ID ' + escapeHtml(evt.employeeId) + '</b><br><small style="color:#e4515e">unregistered — open Devices Hub to add a name</small>';
          tr.innerHTML =
            '<td>' + who + '</td>' +
            '<td>' + escapeHtml(evt.department || '—') + '</td>' +
            '<td>&mdash;</td><td class="hours-good">&mdash;</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td>' +
            '<td><span class="badge blue">Punch ' + time + '</span></td>';
          tb.prepend(tr);
        }
      } catch (_) {}
    }
  };
  try { api.devices.onEvent(onPunch); } catch (_) {}

  // ---------- 3. Atelier layout snapshot / restore ----------
  if (isAtelier) {
    const SNAP_KEY = 'atelier-layout';
    let dirty = false;

    const snapshot = () => {
      try {
        const b = window.__atelierBridge && window.__atelierBridge();
        if (!b) return;
        const st = b.getState();
        api.saveProject(SNAP_KEY, {
          template: st.template,
          brandColor: st.brandColor,
          fireSafety: !!st.fireSafety,
          view: st.view,
          items: (st.placedItems || []).map((p) => ({ type: p.type, x: p.position.x, z: p.position.z, rotY: p.rotation || 0 })),
          savedAt: new Date().toISOString(),
        }).then(() => { dirty = false; });
      } catch (_) {}
    };

    const markDirty = () => { dirty = true; };
    try {
      const listEl = document.getElementById('placedList');
      if (listEl) new MutationObserver(markDirty).observe(listEl, { childList: true, subtree: true });
      const brandInput = document.getElementById('brandColor');
      if (brandInput) brandInput.addEventListener('input', markDirty);
      const templateCards = document.querySelectorAll('.template-card');
      templateCards.forEach((c) => c.addEventListener('click', markDirty));
      ['clearBtn', 'fireSafetyBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', markDirty);
      });
    } catch (_) {}
    setInterval(() => { if (dirty) snapshot(); }, 2500);

    // restore button in the Atelier top bar
    const addRestoreButton = () => {
      try {
        const tb = document.querySelector('.topbar');
        if (!tb || document.getElementById('desktopRestoreBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'desktopRestoreBtn';
        btn.className = 'btn';
        btn.style.cssText = 'margin-left:auto;font-size:11px;border:1px solid var(--oat-dark);background:var(--surface);padding:7px 11px;border-radius:8px;cursor:pointer;color:var(--charcoal);';
        btn.textContent = 'Restore saved layout';
        btn.title = 'Restore the layout last auto-saved to this computer';
        btn.onclick = async () => {
          try {
            const j = await api.loadProject(SNAP_KEY);
            const d = j && j.data;
            if (!d) { toast('No saved layout found'); return; }
            const b = window.__atelierBridge && window.__atelierBridge();
            if (!b) { toast('Workspace not ready yet'); return; }
            b.clearAll();
            if (d.template) b.loadTemplate(d.template);
            if (d.brandColor) b.setBrandColor(d.brandColor);
            (d.items || []).forEach((it) => { try { b.placeItemAt(it.type, it.x, it.z, it.rotY || 0); } catch (_) {} });
            if (d.fireSafety && !b.getState().fireSafety) {
              const fb = document.getElementById('fireSafetyBtn');
              if (fb) fb.click();
            }
            api.auditLog('atelier.restore', SNAP_KEY, { items: (d.items || []).length });
            toast('Layout restored (' + (d.items || []).length + ' items)');
          } catch (e) { toast('Restore failed: ' + e.message); }
        };
        tb.appendChild(btn);
      } catch (_) {}
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addRestoreButton);
    else addRestoreButton();
  }
})();
