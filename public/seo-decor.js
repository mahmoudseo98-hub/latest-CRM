/* seo-decor.js — Office Decor Studio, embedded into the 3D Workspace Visualizer.
   Concept taken from the Atelier planner and merged INTO the SEO OS workspace3d view:
   click-to-place catalog, decor templates, brand color, item count + egress, auto-save,
   plus easy edit: placed-items list, drag-to-move, rotate/delete, undo —
   AND editing the EXISTING office (plants, pendants, employee desks) directly.
   Docked as a grid column (never covers the scene). Requires window.__ws3dCore. */
(function () {
  if (!location.pathname.includes('seo-for-all')) return;

  const LS_KEY = 'seo-office-decor';
  const THEME_KEY = 'seo-ui-theme';
  const COL_OPEN = '236px';
  // Fully hidden when collapsed — this panel's own fold button/vertical label are
  // no longer the way to reopen it; the single "Show panels" button in the 3D
  // Workspace header (index.html) now owns showing/hiding it alongside the other
  // two side panels.
  const COL_CLOSED = '0px';

  const CATALOG = [
    { t: 'desk', name: 'Desk Cluster', icon: '🖥️', w: 1.6, d: 0.9 },
    { t: 'standing', name: 'Standing Desk', icon: '🧍', w: 1.2, d: 0.7 },
    { t: 'meeting', name: 'Meeting Table', icon: '🪑', w: 1.8, d: 1.1 },
    { t: 'chair', name: 'Task Chair', icon: '💺', w: 0.55, d: 0.55 },
    { t: 'sofa', name: 'Lounge Sofa', icon: '🛋️', w: 1.9, d: 0.85 },
    { t: 'shelf', name: 'Bookshelf', icon: '📚', w: 1.0, d: 0.4 },
    { t: 'plant', name: 'Ficus Plant', icon: '🪴', w: 0.6, d: 0.6 },
    { t: 'cooler', name: 'Water Cooler', icon: '🧊', w: 0.5, d: 0.45 },
    { t: 'board', name: 'Whiteboard', icon: '📋', w: 1.5, d: 0.08 },
    { t: 'coffee', name: 'Coffee Corner', icon: '☕', w: 1.1, d: 0.55 },
    { t: 'partition', name: 'Partition', icon: '🧱', w: 1.4, d: 0.08 },
    { t: 'pendant', name: 'Pendant Light', icon: '💡', w: 0.5, d: 0.5 },
  ];
  const BRAND_SWATCHES = ['#5a67f2', '#C7503F', '#0EA5E9', '#14B8A6', '#E59A22', '#8A5CF5', '#2A2828', '#FFFFFF'];
  const FLOOR_SWATCHES = ['#FFFFFF', '#F1F5F9', '#E8DCC4', '#D8DEE9', '#C9C2B4', '#8B8B8B', '#2A2828', '#101828'];
  const TEMPLATES = {
    executive: {
      name: 'Executive',
      items: [
        ['meeting', -1.2, 1.2, 0], ['chair', -2.4, 1.2, 0], ['chair', 0.2, 1.2, 0],
        ['chair', -1.2, 0.1, 0], ['chair', -1.2, 2.3, 0], ['sofa', 3.2, -1.4, -1.2],
        ['shelf', 3.8, 2.2, -0.6], ['plant', 4.4, -2.2, 0.6], ['pendant', -1.2, 1.2, 0],
        ['coffee', -3.9, -1.8, 0.4], ['board', -0.4, 3.4, 0.2],
      ],
    },
    startup: {
      name: 'Startup Loft',
      items: [
        ['desk', -2.4, -0.4, 0.2], ['desk', -2.4, 1.2, 0.4], ['desk', -0.6, -0.4, 0.2],
        ['standing', 1.6, -0.2, 0], ['chair', -3.6, -0.4, 0.2], ['chair', -3.6, 1.2, 0.4],
        ['chair', -1.8, -0.4, 0.2], ['board', -0.6, 3.2, 0], ['coffee', 3.6, -1.6, 0],
        ['plant', 3.8, 1.8, 0], ['plant', -4.2, 2.4, 0], ['pendant', 0.4, 1.0, 0],
        ['pendant', -2.0, 1.0, 0], ['partition', 1.2, 2.6, -0.4],
      ],
    },
    zen: {
      name: 'Minimal Zen',
      items: [
        ['sofa', 0.4, -0.6, -1.2], ['plant', 2.6, 1.4, 0.4], ['plant', -3.0, 1.6, -0.6],
        ['board', 0.2, 3.3, 0], ['cooler', 3.4, 2.2, 0], ['pendant', 0.4, -0.6, 0],
      ],
    },
    empty: { name: 'Clear All', items: [] },
  };

  let core = null;
  let shell = null;
  let panel = null;
  let items = [];
  let selectedId = null;
  let armedType = null;
  let ghost = null;
  let brandColor = '#5a67f2';
  let raycaster = null;
  let plane = null;
  let autosaveTimer = null;
  let inited = false;
  let dragging = null;      // { id, offX, offZ }
  let collapsed = false;
  let officeEdits = {};     // { <template>: { removed:[id], moved:{id:{x,z,ry}}, wsMoved:{id:{x,z,ry}} } }
  let officeFresh = false;  // true right after the app rebuilds the office (ids must be reassigned)
  let syncPending = false;
  let rooms = [];            // extra rooms the CEO has added: { id, name, x, z, ry, w, d, color }
  let roomsGroup = null;
  let focusAnim = 0;         // bumped to cancel an in-flight camera glide
  let floorColor = '#ffffff'; // the main office floor is white by default and stays editable
  let applyingFloorColor = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function mat(color, rough, metal) { return new THREE.MeshStandardMaterial({ color, roughness: rough == null ? 0.7 : rough, metalness: metal == null ? 0 : metal }); }
  function box(w, h, d, m, y) { const g = new THREE.BoxGeometry(w, h, d); const mesh = new THREE.Mesh(g, m); mesh.position.y = y == null ? h / 2 : y; mesh.castShadow = true; return mesh; }
  function cyl(rt, rb, h, m, seg) { const g = new THREE.CylinderGeometry(rt, rb, h, seg || 16); const mesh = new THREE.Mesh(g, m); mesh.position.y = h / 2; mesh.castShadow = true; return mesh; }

  /* ---------- furniture builders ---------- */
  function buildItem(type) {
    const g = new THREE.Group();
    const th = core.DECOR_THEMES[core.ws3dState.theme] || core.DECOR_THEMES.modern_tech;
    const accent = new THREE.Color(brandColor);
    const wood = mat(th.wall, 0.85, 0.05);
    const light = mat(th.deskTop, th.deskRough, 0);
    const dark = mat(th.chairSeat, th.chairRough, 0.1);
    const metal = mat(th.chairLeg, 0.35, 0.8);

    switch (type) {
      case 'desk': {
        const top = box(1.6, 0.06, 0.9, light, 0.73); g.add(top);
        for (const sx of [-0.62, 0.62]) {
          for (const sz of [0.3, -0.3]) { const leg = box(0.08, 0.7, 0.08, metal, 0.35); leg.position.set(sx, 0, sz); g.add(leg); }
        }
        for (const mx of [-0.15, 0.35]) { const mon = box(0.5, 0.32, 0.04, dark, 1.06); mon.position.set(mx, 0, 0.02); g.add(mon); }
        const seat = box(0.44, 0.09, 0.44, th.chairSeat, 0.5); seat.position.set(-0.05, 0, -0.65); g.add(seat);
        const stem = cyl(0.04, 0.05, 0.46, metal, 8); stem.position.set(-0.05, 0, -0.65); g.add(stem);
        break;
      }
      case 'standing': {
        const top = box(1.2, 0.06, 0.7, light, 1.1); g.add(top);
        const legs = box(0.6, 0.05, 0.5, metal, 0.55); g.add(legs);
        const stem = cyl(0.05, 0.06, 0.52, metal, 10); g.add(stem);
        const mon = box(0.45, 0.3, 0.04, dark, 1.42); mon.position.set(0, 0, 0.03); g.add(mon);
        break;
      }
      case 'meeting': {
        const top = box(1.8, 0.07, 1.1, wood, 0.74); g.add(top);
        const base = cyl(0.08, 0.1, 0.7, metal, 10); g.add(base);
        for (const [sx, sz, ry] of [[0.95, 0, 0], [-0.95, 0, 0], [0, 0.62, Math.PI / 2], [0, -0.62, Math.PI / 2], [0.67, 0.62, 0.7], [-0.67, -0.62, 0.7]]) {
          const c = new THREE.Group();
          c.add(box(0.42, 0.08, 0.42, accent, 0.47));
          c.add(cyl(0.035, 0.045, 0.43, metal, 8));
          c.position.set(sx * 1.05, 0, sz * 1.05);
          c.rotation.y = ry;
          g.add(c);
        }
        break;
      }
      case 'chair': {
        g.add(box(0.5, 0.08, 0.5, accent, 0.46));
        g.add(cyl(0.04, 0.05, 0.42, metal, 8));
        const back = box(0.5, 0.55, 0.05, dark, 0.8); back.position.set(0, 0, -0.23); g.add(back);
        break;
      }
      case 'sofa': {
        g.add(box(1.9, 0.34, 0.85, th.chairSeat, 0.17));
        const back = box(1.9, 0.55, 0.2, dark, 0.5); back.position.z = -0.33; g.add(back);
        for (const sx of [-0.45, 0.45]) { const pill = box(0.4, 0.14, 0.3, accent, 0.42); pill.position.set(sx, 0, 0.08); g.add(pill); }
        for (const sx of [-0.9, 0.9]) { const arm = box(0.14, 0.5, 0.85, dark, 0.25); arm.position.x = sx; g.add(arm); }
        break;
      }
      case 'shelf': {
        g.add(box(1.0, 1.9, 0.4, wood, 0.95));
        for (let i = 1; i <= 4; i++) { const shelf = box(0.92, 0.05, 0.36, accent, i * 0.42); g.add(shelf); }
        break;
      }
      case 'plant': {
        const pot = cyl(0.16, 0.12, 0.32, mat(th.plantPot, 0.8), 10); pot.position.y = 0.16; g.add(pot);
        for (let i = 0; i < 5; i++) {
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(th.plantLeaf, 0.9, 0));
          leaf.position.set(Math.cos(i * 1.26) * 0.16, 0.55 + (i % 2) * 0.12, Math.sin(i * 1.26) * 0.16);
          leaf.scale.set(1, 1.4, 1);
          g.add(leaf);
        }
        break;
      }
      case 'cooler': {
        g.add(box(0.34, 0.85, 0.34, mat(0xffffff, 0.3, 0.1), 0.43));
        const bottle = cyl(0.1, 0.12, 0.3, mat(0xbfe3ff, 0.2, 0), 10); bottle.position.y = 1.02; g.add(bottle);
        const tap = box(0.06, 0.04, 0.12, metal, 0.55); tap.position.z = 0.18; g.add(tap);
        break;
      }
      case 'board': {
        const frame = box(1.5, 0.9, 0.05, mat(0xffffff, 0.4), 1.0); g.add(frame);
        const line = box(1.42, 0.82, 0.01, mat(0xeeeeee, 0.6), 1.0); g.add(line);
        for (const sx of [-0.6, 0.6]) { const leg = box(0.05, 0.6, 0.05, metal, 0.3); leg.position.set(sx, 0, 0); g.add(leg); }
        break;
      }
      case 'coffee': {
        g.add(box(1.1, 0.9, 0.55, mat(0xffffff, 0.4), 0.45));
        g.add(box(1.15, 0.06, 0.6, dark, 0.93));
        const machine = box(0.3, 0.34, 0.32, accent, 1.22); machine.position.set(0.2, 0, 0); g.add(machine);
        const cups = box(0.24, 0.08, 0.1, mat(0xffffff, 0.3), 1.06); cups.position.set(-0.3, 0, 0); g.add(cups);
        break;
      }
      case 'partition': {
        const pane = box(1.4, 1.5, 0.05, mat(0xd8deea, 0.6, 0.05), 0.75); g.add(pane);
        const strip = box(1.44, 0.1, 0.06, accent, 1.45); g.add(strip);
        break;
      }
      case 'pendant': {
        const cord = cyl(0.015, 0.015, 1.7, metal, 6); cord.position.y = 2.5; g.add(cord);
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.4, 16), mat(accent, 0.4, 0.05)); shade.position.y = 1.55; g.add(shade);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(0xfff2c0, 0.3, 0)); bulb.position.y = 1.4; g.add(bulb);
        break;
      }
    }
    return g;
  }

  /* ---------- extra rooms ---------- */
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function makeLabelSprite(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 44;
    ctx.font = 'bold ' + fontSize + 'px system-ui, -apple-system, Segoe UI, sans-serif';
    const padX = 26, padY = 14;
    const textW = Math.max(20, ctx.measureText(text).width);
    canvas.width = Math.ceil(textW + padX * 2);
    canvas.height = fontSize + padY * 2;
    ctx.font = 'bold ' + fontSize + 'px system-ui, -apple-system, Segoe UI, sans-serif';
    roundRectPath(ctx, 0, 0, canvas.width, canvas.height, 16);
    ctx.fillStyle = 'rgba(16,20,34,0.86)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, padX, canvas.height / 2 + 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    const scale = 0.0065;
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
    sprite.renderOrder = 999;
    return sprite;
  }
  function roomBounds() { return { hw: core.ROOM_W * 2, hd: core.ROOM_D * 2 }; }
  function clampRoomPos(x, z) { const b = roomBounds(); return { x: Math.max(-b.hw, Math.min(b.hw, x)), z: Math.max(-b.hd, Math.min(b.hd, z)) }; }
  function buildRoom(room) {
    const g = new THREE.Group();
    const floorGeo = new THREE.PlaneGeometry(room.w, room.d);
    const floorMesh = new THREE.Mesh(floorGeo, mat(room.color || '#ffffff', 0.75, 0));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.012;
    floorMesh.receiveShadow = true;
    g.add(floorMesh);
    const wallH = 1.6;
    const wallMatRoom = new THREE.MeshStandardMaterial({ color: 0xc9d3e6, transparent: true, opacity: 0.4, roughness: 0.3, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    const mkWall = (w, d, x, z) => { const wm = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMatRoom); wm.position.set(x, wallH / 2 + 0.012, z); wm.castShadow = false; g.add(wm); };
    mkWall(room.w, 0.08, 0, -room.d / 2);
    mkWall(room.w, 0.08, 0, room.d / 2);
    mkWall(0.08, room.d, -room.w / 2, 0);
    mkWall(0.08, room.d, room.w / 2, 0);
    const label = makeLabelSprite(room.name || 'Room');
    label.position.set(0, wallH + 0.45, 0);
    g.add(label);
    g.userData.isRoom = true;
    return g;
  }
  function rebuildRooms() {
    if (!roomsGroup) { roomsGroup = new THREE.Group(); core.scene.add(roomsGroup); }
    while (roomsGroup.children.length) {
      const c = roomsGroup.children[0];
      roomsGroup.remove(c);
      c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); });
    }
    rooms.forEach((r) => {
      const mesh = buildRoom(r);
      mesh.position.set(r.x, 0, r.z);
      mesh.rotation.y = r.ry || 0;
      mesh.userData.decorId = r.id;
      roomsGroup.add(mesh);
    });
    updateCost();
    renderRooms();
  }
  // Rooms are placed beside the original office shell, which sits outside the
  // default camera view — so glide the camera over to whatever we just added or
  // the row the user clicked, otherwise the room is invisible and feels broken.
  function focusOn(x, z, spread) {
    if (!core || !core.camera || !core.controls) return;
    const token = ++focusAnim;
    const cam = core.camera;
    const ctr = core.controls;
    const dist = Math.max(10, (spread || 6) * 2.1);
    const startPos = cam.position.clone();
    const startTgt = ctr.target.clone();
    const endTgt = new THREE.Vector3(x, 0.5, z);
    const dir = startPos.clone().sub(startTgt);
    if (dir.lengthSq() < 0.0001) dir.set(7, 6, 9);
    const endPos = endTgt.clone().add(dir.normalize().multiplyScalar(dist));
    const t0 = performance.now();
    const dur = 450;
    (function step() {
      if (token !== focusAnim) return;   // superseded, or the user grabbed the scene
      const t = Math.min(1, (performance.now() - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      cam.position.lerpVectors(startPos, endPos, eased);
      ctr.target.lerpVectors(startTgt, endTgt, eased);
      ctr.update();
      if (t < 1) requestAnimationFrame(step);
    })();
  }

  function addRoom(spec) {
    const id = nextRoomId();
    const w = Math.max(2, Math.min(20, spec.w || 6));
    const d = Math.max(2, Math.min(20, spec.d || 5));
    const x = core.ROOM_W / 2 + 1.0 + w / 2;
    const z = -core.ROOM_D / 2 + d / 2 + rooms.length * (d + 1.2);
    const room = { id, name: spec.name || ('Room ' + (rooms.length + 1)), x, z, ry: 0, w, d, color: spec.color || '#ffffff' };
    rooms.push(room);
    const mesh = buildRoom(room);
    mesh.position.set(room.x, 0, room.z);
    mesh.userData.decorId = id;
    roomsGroup.add(mesh);
    updateCost(); renderRooms(); scheduleSave();
    select(id);
    focusOn(room.x, room.z, Math.max(room.w, room.d));
    if (typeof showToast === 'function') showToast('Added room "' + room.name + '" — drag it into place');
    return room;
  }
  function removeRoom(id) {
    rooms = rooms.filter((r) => r.id !== id);
    const mesh = meshById(id);
    if (mesh) roomsGroup.remove(mesh);
    if (selectedId === id) { selectedId = null; updateActionBar(); }
    updateCost(); renderRooms(); scheduleSave();
  }
  function renderRooms() {
    if (!panel) return;
    const wrap = panel.querySelector('.decor-room-list');
    if (!wrap) return;
    if (!rooms.length) { wrap.innerHTML = '<div class="decor-placed-empty">No extra rooms yet — name one above and click Add room.</div>'; return; }
    wrap.innerHTML = rooms.map((r) =>
      '<div class="decor-placed ' + (r.id === selectedId ? 'sel' : '') + '" data-id="' + r.id + '" title="click to jump the camera to it · drag to move · R rotate · ✕ removes">' +
      '<span class="dp-name">' + esc(r.name) + '</span>' +
      '<button class="dp-del" data-id="' + r.id + '" title="remove room">✕</button></div>').join('');
    wrap.querySelectorAll('.dp-del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeRoom(b.dataset.id); }));
    wrap.querySelectorAll('.decor-placed').forEach((row) => row.addEventListener('click', () => {
      const id = row.dataset.id;
      select(id);
      const r = rooms.find((x) => x.id === id);
      if (r) focusOn(r.x, r.z, Math.max(r.w, r.d));
    }));
  }

  /* ---------- floor color ---------- */
  function hookFloorMat() {
    const fm = core.floorMat;
    if (!fm || fm.__decorHooked) return;
    fm.__decorHooked = true;
    const origSetHex = fm.color.setHex.bind(fm.color);
    fm.color.setHex = function (hex) {
      const r = origSetHex(hex);
      if (floorColor && !applyingFloorColor) {
        applyingFloorColor = true;
        fm.color.set(floorColor);
        applyingFloorColor = false;
      }
      return r;
    };
  }
  function setFloorColor(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    floorColor = hex;
    applyingFloorColor = true;
    if (core.floorMat) core.floorMat.color.set(hex);
    applyingFloorColor = false;
    if (panel) {
      const inp = panel.querySelector('#decorFloorHex');
      if (inp) inp.value = hex;
      panel.querySelectorAll('.decor-floor-swatch').forEach((s) => s.classList.toggle('active', s.dataset.c.toLowerCase() === hex.toLowerCase()));
    }
    scheduleSave();
  }

  /* ---------- persistence ---------- */
  function save() {
    const data = {
      items: items.map((it) => ({ t: it.t, x: it.x, z: it.z, ry: it.ry })),
      rooms: rooms.map((r) => ({ name: r.name, x: r.x, z: r.z, ry: r.ry, w: r.w, d: r.d, color: r.color })),
      brand: brandColor, theme: core.ws3dState.theme,
      floorColor: floorColor,
      officeEdits: officeEdits,
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (_) {}
    const st = panel && panel.querySelector('.decor-autosave');
    if (st) st.textContent = 'AUTO-SAVED ✓';
  }
  function scheduleSave() { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(save, 700); }

  function restore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) {}
    if (!data) return;
    if (data.theme && core.DECOR_THEMES[data.theme]) { core.ws3dState.theme = data.theme; core.ws3dApplyDecor(); }
    if (data.brand) setBrand(data.brand, true);
    setFloorColor(/^#[0-9a-fA-F]{6}$/.test(data.floorColor || '') ? data.floorColor : floorColor);
    if (data.officeEdits) officeEdits = data.officeEdits;
    (data.items || []).forEach((it) => { if (CATALOG.some((c) => c.t === it.t)) items.push({ t: it.t, x: it.x, z: it.z, ry: it.ry || 0, id: nextId() }); });
    (data.rooms || []).forEach((r) => { rooms.push({ id: nextRoomId(), name: r.name || 'Room', x: r.x || 0, z: r.z || 0, ry: r.ry || 0, w: r.w || 6, d: r.d || 5, color: /^#[0-9a-fA-F]{6}$/.test(r.color || '') ? r.color : '#ffffff' }); });
  }

  /* ---------- scene management ---------- */
  let group = null;
  let idCounter = 1;
  function nextId() { return 'd' + (idCounter++); }
  function nextRoomId() { return 'r' + (idCounter++); }
  function bounds() { return { hw: core.ROOM_W / 2 - 0.7, hd: core.ROOM_D / 2 - 0.7 }; }
  function clampPos(x, z) { const b = bounds(); return { x: Math.max(-b.hw, Math.min(b.hw, x)), z: Math.max(-b.hd, Math.min(b.hd, z)) }; }

  function rebuild() {
    if (!group) { group = new THREE.Group(); core.scene.add(group); }
    while (group.children.length) { const c = group.children[0]; group.remove(c); if (c.geometry) c.geometry.dispose(); }
    items.forEach((it) => {
      const mesh = buildItem(it.t);
      mesh.position.set(it.x, 0, it.z);
      mesh.rotation.y = it.ry || 0;
      mesh.userData.decorId = it.id;
      group.add(mesh);
    });
    updateCost();
    renderPlaced();
  }

  /* ---------- existing office (plants / pendants / employee desks) ---------- */
  function workstations() {
    if (!core || !core.scene) return [];
    return core.scene.children.filter((c) => c.userData && c.userData.employee);
  }
  function officeEditsFor() {
    const t = core.ws3dState.template;
    if (!officeEdits[t]) officeEdits[t] = { removed: [], moved: {}, wsMoved: {} };
    return officeEdits[t];
  }
  function applyOfficeEdits() {
    if (!core || !core.scene || !core.decoGroup) return;
    const ed = officeEditsFor();
    if (officeFresh) {
      core.decoGroup.children.forEach((c, i) => { c.userData.decorId = 'o:deco:' + i; });
      workstations().forEach((w, i) => { w.userData.decorId = 'o:ws:' + i; });
      officeFresh = false;
    }
    // apply removals (plants/pendants)
    [...core.decoGroup.children].forEach((c) => {
      if (ed.removed.indexOf(c.userData.decorId) !== -1) core.decoGroup.remove(c);
    });
    // Employee desks aren't deleted from companyData by the trash button (that's
    // an HR action, done from "Edit employees & departments") — just hidden from
    // the 3D scene. Re-applied on every rebuild so it survives template/theme
    // switches, and a workstation's own userData stays intact for stats/coverage.
    workstations().forEach((w) => {
      w.visible = ed.removed.indexOf(w.userData.decorId) === -1;
    });
    // apply moves
    Object.entries(ed.moved).forEach(([id, m]) => {
      const c = core.decoGroup.children.find((x) => x.userData.decorId === id);
      if (c) { c.position.set(m.x, 0, m.z); c.rotation.y = m.ry || 0; }
    });
    Object.entries(ed.wsMoved).forEach(([id, m]) => {
      const w = workstations().find((x) => x.userData.decorId === id);
      if (w) { w.position.set(m.x, 0, m.z); w.rotation.y = m.ry || 0; }
    });
    renderOfficeList();
    updateActionBar();
  }
  function scheduleSync() {
    if (syncPending) return;
    syncPending = true;
    setTimeout(() => { syncPending = false; applyOfficeEdits(); }, 0);
  }
  function hookOfficeRebuild() {
    // The app rebuilds decoGroup inside its own module scope, so intercept the
    // group's add() to know when the existing office changed.
    const dg = core.decoGroup;
    if (dg.__decorHooked) return;
    dg.__decorHooked = true;
    const oAdd = dg.add.bind(dg);
    dg.add = function (...a) { const r = oAdd.apply(dg, a); officeFresh = true; scheduleSync(); return r; };
  }
  function officeEntry(id) {
    // returns { store, key } where store[key] is the persisted move record
    const ed = officeEditsFor();
    if (id.indexOf('o:deco:') === 0) return { store: ed.moved, key: id };
    if (id.indexOf('o:ws:') === 0) return { store: ed.wsMoved, key: id };
    return null;
  }
  function officeRowName(id) {
    if (id.indexOf('o:deco:') === 0) {
      const idx = parseInt(id.split(':')[2], 10);
      return idx < 4 ? 'Office Plant ' + (idx + 1) : 'Pendant ' + (idx + 1);
    }
    if (id.indexOf('o:ws:') === 0) {
      const w = workstations().find((x) => x.userData.decorId === id);
      const emp = w && w.userData.employee && w.userData.employee.name;
      return emp ? emp + "'s Desk" : 'Employee Desk';
    }
    return null;
  }
  function isOfficeDesk(id) { return id.indexOf('o:ws:') === 0; }
  function resetOffice() {
    const t = core.ws3dState.template;
    delete officeEdits[t];
    officeFresh = true;
    if (typeof core.loadTemplate === 'function') core.loadTemplate(t);
    applyOfficeEdits();
    scheduleSave();
  }

  function meshById(id) {
    if (!id) return null;
    if (id.indexOf('o:deco:') === 0) return core.decoGroup.children.find((c) => c.userData.decorId === id) || null;
    if (id.indexOf('o:ws:') === 0) return workstations().find((w) => w.userData.decorId === id) || null;
    if (/^r\d/.test(id)) return roomsGroup ? roomsGroup.children.find((m) => m.userData.decorId === id) : null;
    return group ? group.children.find((m) => m.userData.decorId === id) : null;
  }
  function itemById(id) {
    if (id && /^r\d/.test(id)) return rooms.find((r) => r.id === id);
    return items.find((i) => i.id === id);
  }
  function allSelectable() {
    return [].concat(group ? group.children : [], roomsGroup ? roomsGroup.children : [], core.decoGroup ? core.decoGroup.children : [], workstations());
  }

  function updateCost() {
    if (!panel) return;
    const seats = items.filter((it) => ['chair', 'meeting', 'desk', 'standing'].includes(it.t)).length;
    panel.querySelector('.decor-count').textContent = items.length + ' items' + (rooms.length ? ' · ' + rooms.length + ' room' + (rooms.length === 1 ? '' : 's') : '');
    const area = core.ROOM_W * core.ROOM_D + rooms.reduce((s, r) => s + r.w * r.d, 0);
    const capacity = Math.floor(area / 3.2);
    const staff = (window.companyData && companyData.employees ? companyData.employees.length : 0);
    const occ = staff + seats;
    const badge = panel.querySelector('.decor-egress');
    const ok = occ <= capacity;
    badge.textContent = 'EGRESS ' + (ok ? 'COMPLIANT' : 'WARNING');
    badge.className = 'decor-egress ' + (ok ? 'ok' : 'warn');
    badge.title = occ + ' occupants vs ' + capacity + ' capacity (' + area + ' m² floor)';
  }

  /* ---------- lists ---------- */
  function renderPlaced() {
    if (!panel) return;
    const wrap = panel.querySelector('.decor-placed-list');
    if (!wrap) return;
    if (!items.length) { wrap.innerHTML = '<div class="decor-placed-empty">Nothing added yet — pick a furniture item above, then click the floor.</div>'; return; }
    wrap.innerHTML = items.map((it) => {
      const c = CATALOG.find((x) => x.t === it.t) || { name: it.t };
      return '<div class="decor-placed ' + (it.id === selectedId ? 'sel' : '') + '" data-id="' + it.id + '">' +
        '<span class="dp-name">' + esc(c.name) + '</span>' +
        '<button class="dp-del" data-id="' + it.id + '" title="remove">✕</button></div>';
    }).join('');
    wrap.querySelectorAll('.dp-del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeItem(b.dataset.id); }));
    wrap.querySelectorAll('.decor-placed').forEach((row) => row.addEventListener('click', () => select(row.dataset.id)));
  }
  function renderOfficeList() {
    if (!panel) return;
    const wrap = panel.querySelector('.decor-office-list');
    if (!wrap) return;
    const rows = [];
    (core.decoGroup.children || []).forEach((c) => {
      const id = c.userData.decorId;
      if (id) rows.push({ id, name: officeRowName(id), desk: false });
    });
    workstations().forEach((w) => {
      const id = w.userData.decorId;
      if (id) rows.push({ id, name: officeRowName(id), desk: true });
    });
    if (!rows.length) { wrap.innerHTML = '<div class="decor-placed-empty">No existing office furniture in this layout.</div>'; return; }
    wrap.innerHTML = rows.map((r) =>
      '<div class="decor-placed ' + (r.id === selectedId ? 'sel' : '') + '" data-id="' + r.id + '" title="' + (r.desk ? 'employee desk — drag to move · ✕ hides it (RESET brings it back)' : 'click to select · drag to move · ✕ removes') + '">' +
      '<span class="dp-name">' + esc(r.name) + '</span>' +
      (r.desk ? '<span class="dp-desk">DESK</span>' : '') +
      '<button class="dp-del" data-id="' + r.id + '" title="' + (r.desk ? 'hide this desk' : 'remove') + '">✕</button>' +
      '</div>').join('');
    wrap.querySelectorAll('.dp-del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeSelectedId(b.dataset.id); }));
    wrap.querySelectorAll('.decor-placed').forEach((row) => row.addEventListener('click', () => select(row.dataset.id)));
  }

  /* ---------- add / edit / remove ---------- */
  function placeAt(type, x, z) {
    const it = { t: type, x, z, ry: 0, id: nextId() };
    items.push(it);
    const mesh = buildItem(type);
    mesh.position.set(x, 0, z);
    mesh.userData.decorId = it.id;
    group.add(mesh);
    updateCost(); renderPlaced(); scheduleSave();
    return it;
  }

  function removeItem(id) {
    items = items.filter((i) => i.id !== id);
    const mesh = meshById(id);
    if (mesh) group.remove(mesh);
    if (selectedId === id) { selectedId = null; updateActionBar(); }
    updateCost(); renderPlaced(); updateActionBar(); scheduleSave();
  }

  function removeSelectedId(id) {
    if (id.indexOf('o:deco:') === 0 || isOfficeDesk(id)) {
      const mesh = meshById(id);
      if (isOfficeDesk(id)) {
        // Hide, don't delete: the employee record stays intact, only the desk
        // disappears from the 3D scene. RESET (or a role/template change) brings
        // it back.
        if (mesh) mesh.visible = false;
      } else if (mesh) {
        core.decoGroup.remove(mesh);
      }
      const ed = officeEditsFor();
      if (ed.removed.indexOf(id) === -1) ed.removed.push(id);
      if (selectedId === id) { selectedId = null; updateActionBar(); }
      renderOfficeList(); scheduleSave();
      return;
    }
    if (/^r\d/.test(id)) { removeRoom(id); return; }
    removeItem(id);
  }

  function removeSelected() { if (selectedId) removeSelectedId(selectedId); }

  function undoLast() {
    if (!items.length) return;
    removeItem(items[items.length - 1].id);
  }

  function clearAll() {
    items = [];
    selectedId = null;
    rebuild();
    updateActionBar();
    scheduleSave();
  }

  function applyTemplate(name) {
    const tpl = TEMPLATES[name];
    if (!tpl) return;
    items = [];
    selectedId = null;
    if (name !== 'empty') tpl.items.forEach(([t, x, z, ry]) => { items.push({ t, x, z, ry: ry || 0, id: nextId() }); });
    rebuild();
    updateActionBar();
    scheduleSave();
  }

  function setBrand(hex, silent) {
    brandColor = hex;
    if (panel) {
      const inp = panel.querySelector('.decor-hex');
      if (inp) inp.value = hex;
      panel.querySelectorAll('.decor-swatch').forEach((s) => s.classList.toggle('active', s.dataset.c.toLowerCase() === hex.toLowerCase()));
    }
    if (!silent) { rebuild(); scheduleSave(); }
  }

  function companyBrand() {
    const css = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    if (css && /^#/.test(css)) setBrand(css);
  }

  /* ---------- dark / light UI theme ---------- */
  function applyUiTheme(mode) {
    const dark = mode === 'dark';
    document.documentElement.classList.toggle('theme-dark', dark);
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (_) {}
    const icons = document.querySelectorAll('.decor-theme');
    icons.forEach((b) => { b.textContent = dark ? '☀️' : '🌙'; b.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; });
  }
  function toggleUiTheme() {
    applyUiTheme(document.documentElement.classList.contains('theme-dark') ? 'light' : 'dark');
  }
  function addThemeButtons() {
    // decor panel header button
    const head = panel && panel.querySelector('.decor-head span');
    if (head && !head.querySelector('.decor-theme')) {
      const b = document.createElement('button');
      b.className = 'decor-theme';
      b.id = 'decorTheme';
      b.title = 'Switch to dark mode';
      b.textContent = '🌙';
      b.addEventListener('click', toggleUiTheme);
      head.insertBefore(b, head.firstChild);
    }
    // app topbar button
    const actions = document.querySelector('.top-actions');
    if (actions && !actions.querySelector('.decor-theme')) {
      const b = document.createElement('button');
      b.className = 'decor-theme top-theme';
      b.title = 'Switch to dark mode';
      b.textContent = '🌙';
      b.addEventListener('click', toggleUiTheme);
      actions.insertBefore(b, actions.firstChild);
    }
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (_) {}
    applyUiTheme(stored === 'dark' ? 'dark' : 'light');
  }

  /* ---------- selection + drag ---------- */
  function select(id) {
    selectedId = id;
    allSelectable().forEach((m) => {
      const sel = m.userData.decorId === id;
      m.traverse((o) => { if (o.isMesh) o.material = o.userData.origMat || o.material; });
      if (sel) {
        m.traverse((o) => {
          if (o.isMesh) {
            if (!o.userData.origMat) o.userData.origMat = o.material;
            const hl = o.material.clone();
            // Only lit materials (Standard/Phong/Lambert/...) have an emissive
            // channel; forcing it onto e.g. MeshBasicMaterial leaves the clone
            // with no matching shader uniform and crashes the WHOLE render loop
            // on the next frame — freezing the entire 3D scene. Tint via color
            // instead for materials that don't support emissive.
            if (hl.emissive) {
              hl.emissive = new THREE.Color(0xffc94a);
              hl.emissiveIntensity = 0.35;
            } else if (hl.color) {
              hl.color = new THREE.Color(0xffc94a);
            }
            o.material = hl;
          }
        });
      }
    });
    renderPlaced();
    renderOfficeList();
    renderRooms();
    updateActionBar();
    const hint = panel && panel.querySelector('.decor-hint');
    if (hint) {
      if (!id) hint.textContent = 'CLICK AN ITEM ABOVE, THEN CLICK THE FLOOR';
      else if (isOfficeDesk(id)) hint.textContent = 'EMPLOYEE DESK — drag to move · R rotate · Del hides it';
      else if (id.indexOf('o:deco:') === 0) hint.textContent = 'EXISTING OFFICE — drag to move · R rotate · Del remove';
      else if (/^r\d/.test(id)) hint.textContent = 'ROOM — drag to move · R rotate · Del delete';
      else hint.textContent = 'SELECTED — drag to move · R rotate · Del delete';
    }
  }

  function rotateSelected() {
    if (!selectedId) return;
    const mesh = meshById(selectedId);
    if (!mesh) return;
    const ny = (mesh.rotation.y || 0) + Math.PI / 4;
    mesh.rotation.y = ny;
    const ent = officeEntry(selectedId);
    if (ent) {
      const rec = ent.store[ent.key] || (ent.store[ent.key] = { x: mesh.position.x, z: mesh.position.z, ry: 0 });
      rec.ry = ny;
      scheduleSave();
    } else {
      const it = itemById(selectedId);
      if (it) { it.ry = ny; scheduleSave(); }
    }
    updateActionBar();
  }

  function pickItem(event) {
    raycaster.setFromCamera(mouseNDC, core.camera);
    const targets = [].concat(group ? group.children : [], roomsGroup ? roomsGroup.children : [], core.decoGroup ? core.decoGroup.children : [], workstations());
    if (!targets.length) return null;
    const hits = raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.decorId) o = o.parent;
      if (o && o.userData.decorId) return o.userData.decorId;
    }
    return null;
  }

  const mouseNDC = { x: 0, y: 0 };
  function setMouse(e) {
    const rect = core.renderer.domElement.getBoundingClientRect();
    mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }
  function floorPoint() {
    raycaster.setFromCamera(mouseNDC, core.camera);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return hit || null;
  }

  function onPointerMove(e) {
    setMouse(e);
    if (armedType && ghost) {
      const hit = floorPoint();
      if (hit) {
        const snap = 0.25;
        const p = clampPos(Math.round(hit.x / snap) * snap, Math.round(hit.z / snap) * snap);
        ghost.position.set(p.x, 0, p.z);
        ghost.visible = true;
      }
    } else if (dragging) {
      const hit = floorPoint();
      if (hit) {
        const mesh = meshById(dragging.id);
        if (mesh) {
          const snap = 0.25;
          const clampFn = /^r\d/.test(dragging.id) ? clampRoomPos : clampPos;
          const p = clampFn(Math.round((hit.x - dragging.offX) / snap) * snap, Math.round((hit.z - dragging.offZ) / snap) * snap);
          mesh.position.set(p.x, 0, p.z);
          const ent = officeEntry(dragging.id);
          if (ent) {
            const rec = ent.store[ent.key] || (ent.store[ent.key] = { x: mesh.position.x, z: mesh.position.z, ry: mesh.rotation.y || 0 });
            rec.x = p.x; rec.z = p.z;
          } else {
            const it = itemById(dragging.id);
            if (it) { it.x = p.x; it.z = p.z; }
          }
          updateActionBar();
        }
      }
    } else {
      updateActionBar();
    }
  }

  function onPointerDown(e) {
    focusAnim++;   // stop any camera glide the moment the user touches the scene
    if (armedType) {
      e.preventDefault();
      e.stopPropagation();
      // Placing a new item: keep the orbit camera from grabbing this same click.
      if (core.controls) core.controls.enabled = false;
      if (ghost && ghost.visible) {
        const snap = 0.25;
        const p = clampPos(ghost.position.x, ghost.position.z);
        placeAt(armedType, Math.round(p.x / snap) * snap, Math.round(p.z / snap) * snap);
      }
      return;
    }
    const id = pickItem(e);
    if (id) {
      // click on any furniture (added or existing): select + begin potential drag
      e.preventDefault();
      e.stopPropagation();
      select(id);
      const mesh = meshById(id);
      const hit = floorPoint();
      if (mesh && hit) {
        dragging = { id, offX: hit.x - mesh.position.x, offZ: hit.z - mesh.position.z };
        // Without this, OrbitControls fights the drag on the very same pointer
        // events and the item snaps back / never visibly moves.
        if (core.controls) core.controls.enabled = false;
      }
      return;
    }
    select(null);
  }

  function onPointerUp() {
    if (dragging) { dragging = null; scheduleSave(); }
    if (core.controls) core.controls.enabled = true;
  }

  /* ---------- on-canvas action bar for the selected item ---------- */
  let actBar = null;
  function buildActBar() {
    actBar = document.createElement('div');
    actBar.className = 'decor-actbar';
    actBar.style.display = 'none';
    actBar.innerHTML = '<button data-act="rot" title="rotate 45°">⟲</button><button data-act="del" title="delete">🗑</button><button data-act="done" title="done">✓</button>';
    actBar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'rot') rotateSelected();
      if (b.dataset.act === 'del') removeSelected();
      if (b.dataset.act === 'done') select(null);
    });
    core.container.appendChild(actBar);
  }
  function updateActionBar() {
    if (!actBar) return;
    if (!selectedId) { actBar.style.display = 'none'; return; }
    const mesh = meshById(selectedId);
    if (!mesh) { actBar.style.display = 'none'; return; }
    const v = new THREE.Vector3();
    mesh.getWorldPosition(v);
    v.y += 1.35;
    v.project(core.camera);
    if (v.z > 1) { actBar.style.display = 'none'; return; }
    const rect = core.container.getBoundingClientRect();
    const x = (v.x * 0.5 + 0.5) * rect.width;
    const y = (-v.y * 0.5 + 0.5) * rect.height;
    actBar.style.display = 'flex';
    actBar.style.left = Math.max(8, Math.min(rect.width - 118, x - 60)) + 'px';
    actBar.style.top = Math.max(4, Math.min(rect.height - 40, y - 24)) + 'px';
  }

  /* ---------- layout: docked column (never covers content) ---------- */
  function setColumn(open) {
    collapsed = !open;
    const shellStyle = shell.style;
    shellStyle.setProperty('--decor-w', open ? COL_OPEN : COL_CLOSED);
    if (panel) panel.classList.toggle('collapsed', !open);
    const fold = panel && panel.querySelector('#decorFold');
    if (fold) fold.textContent = open ? '»' : '«';
    const lbl = panel && panel.querySelector('.decor-vlabel');
    if (lbl) lbl.style.display = open ? 'none' : 'block';
    const body = panel && panel.querySelector('.decor-body');
    if (body) body.style.display = open ? 'flex' : 'none';
    setTimeout(resizeCanvas, 60);
  }
  function resizeCanvas() {
    if (!core || !core.container) return;
    try {
      if (core.container.clientWidth > 0) core.renderer.setSize(core.container.clientWidth, core.container.clientHeight);
    } catch (_) {}
  }

  /* ---------- panel UI ---------- */
  function buildPanel() {
    const el = document.createElement('div');
    el.className = 'decor-panel';
    el.innerHTML = `
      <div class="decor-vlabel" style="display:none">OFFICE DECOR</div>
      <div class="decor-head">
        <b>OFFICE DECOR</b>
        <span style="display:flex;gap:8px;align-items:center"><span class="decor-autosave"></span><button class="decor-fold" id="decorFold" title="collapse/expand">»</button></span>
      </div>
      <div class="decor-body">
        <div class="decor-scroll">
          <div class="decor-sub">DECOR TEMPLATES — ONE CLICK</div>
          <div class="decor-tpls" id="decorTpls"></div>
          <div class="decor-sub">FURNITURE — CLICK ITEM, THEN CLICK THE FLOOR</div>
          <div class="decor-catalog" id="decorCatalog"></div>
          <div class="decor-sub">BRAND COLOR</div>
          <div class="decor-brand">
            <div class="decor-swatches" id="decorSwatches"></div>
            <input class="decor-hex" value="${brandColor}" maxlength="7" spellcheck="false">
            <button class="decor-co" id="decorCompany">COMPANY</button>
          </div>
          <div class="decor-sub">FLOOR COLOR</div>
          <div class="decor-brand">
            <div class="decor-swatches" id="decorFloorSwatches"></div>
            <input class="decor-hex" id="decorFloorHex" value="${floorColor}" maxlength="7" spellcheck="false">
            <button class="decor-co" id="decorFloorWhite" title="reset the floor to white">WHITE</button>
          </div>
          <div class="decor-subrow">
            <span class="decor-sub">EXISTING OFFICE — CLICK TO EDIT</span>
            <button class="decor-reset" id="decorResetOffice" title="restore the default layout of the current template">RESET</button>
          </div>
          <div class="decor-office-list" id="decorOffice"></div>
          <div class="decor-sub">ROOMS — ADD ANOTHER ROOM TO THE OFFICE</div>
          <div class="decor-room-form">
            <input id="decorRoomName" placeholder="Room name (e.g. Meeting Room)">
            <div class="decor-room-dims">
              <label>W<input id="decorRoomW" type="number" min="2" max="20" step="0.5" value="6" title="Width (m)"></label>
              <label>D<input id="decorRoomD" type="number" min="2" max="20" step="0.5" value="5" title="Depth (m)"></label>
              <input id="decorRoomColor" type="color" value="#ffffff" title="Room floor color">
            </div>
            <button class="decor-btn" id="decorAddRoom" style="width:100%">＋ ADD ROOM</button>
          </div>
          <div class="decor-room-list" id="decorRooms"></div>
          <div class="decor-sub">PLACED ITEMS (${items.length})</div>
          <div class="decor-placed-list" id="decorPlaced"></div>
          <div class="decor-actions">
            <button class="decor-btn" id="decorUndo">↶ UNDO</button>
            <button class="decor-btn" id="decorExport">PNG</button>
            <button class="decor-btn danger" id="decorClear">CLEAR</button>
          </div>
        </div>
        <div class="decor-foot">
          <div><span class="decor-count">0 items</span></div>
          <div class="decor-egress ok">EGRESS COMPLIANT</div>
          <div class="decor-hint">CLICK AN ITEM ABOVE, THEN CLICK THE FLOOR</div>
        </div>
      </div>`;
    shell.appendChild(el);
    panel = el;

    panel.querySelector('#decorTpls').innerHTML = Object.entries(TEMPLATES).map(([k, v]) =>
      `<button class="decor-tpl" data-tpl="${k}">${esc(v.name)}</button>`).join('');
    panel.querySelector('#decorCatalog').innerHTML = CATALOG.map((c) =>
      `<button class="decor-item" data-t="${c.t}"><span class="di-ico">${c.icon}</span><b>${esc(c.name)}</b></button>`).join('');
    panel.querySelector('#decorSwatches').innerHTML = BRAND_SWATCHES.map((c) =>
      `<button class="decor-swatch ${c.toLowerCase() === brandColor.toLowerCase() ? 'active' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
    panel.querySelector('#decorFloorSwatches').innerHTML = FLOOR_SWATCHES.map((c) =>
      `<button class="decor-swatch decor-floor-swatch ${c.toLowerCase() === floorColor.toLowerCase() ? 'active' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');

    panel.querySelector('#decorTpls').addEventListener('click', (e) => {
      const b = e.target.closest('.decor-tpl');
      if (b) applyTemplate(b.dataset.tpl);
    });
    panel.querySelector('#decorCatalog').addEventListener('click', (e) => {
      const b = e.target.closest('.decor-item');
      if (!b) return;
      armedType = armedType === b.dataset.t ? null : b.dataset.t;
      panel.querySelectorAll('.decor-item').forEach((x) => x.classList.toggle('active', x === b));
      panel.querySelector('.decor-hint').textContent = armedType
        ? 'PLACING: ' + (CATALOG.find((c) => c.t === armedType) || {}).name + ' — CLICK THE FLOOR · ESC to cancel'
        : 'CLICK AN ITEM ABOVE, THEN CLICK THE FLOOR';
    });
    panel.querySelector('#decorSwatches').addEventListener('click', (e) => {
      const b = e.target.closest('.decor-swatch');
      if (b) setBrand(b.dataset.c);
    });
    panel.querySelector('.decor-hex').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) setBrand(v);
    });
    panel.querySelector('.decor-hex').addEventListener('keydown', (e) => e.stopPropagation());
    panel.querySelector('#decorCompany').addEventListener('click', companyBrand);
    panel.querySelector('#decorFloorSwatches').addEventListener('click', (e) => {
      const b = e.target.closest('.decor-floor-swatch');
      if (b) setFloorColor(b.dataset.c);
    });
    panel.querySelector('#decorFloorHex').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) setFloorColor(v);
    });
    panel.querySelector('#decorFloorHex').addEventListener('keydown', (e) => e.stopPropagation());
    panel.querySelector('#decorFloorWhite').addEventListener('click', () => setFloorColor('#ffffff'));
    panel.querySelector('#decorAddRoom').addEventListener('click', () => {
      const nameInp = panel.querySelector('#decorRoomName');
      const wInp = panel.querySelector('#decorRoomW');
      const dInp = panel.querySelector('#decorRoomD');
      const colorInp = panel.querySelector('#decorRoomColor');
      const name = (nameInp.value || '').trim() || ('Room ' + (rooms.length + 1));
      addRoom({ name, w: Number(wInp.value) || 6, d: Number(dInp.value) || 5, color: colorInp.value || '#ffffff' });
      nameInp.value = '';
    });
    panel.querySelector('#decorRoomName').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') panel.querySelector('#decorAddRoom').click(); });
    panel.querySelectorAll('#decorRoomW,#decorRoomD').forEach((inp) => inp.addEventListener('keydown', (e) => e.stopPropagation()));
    panel.querySelector('#decorUndo').addEventListener('click', undoLast);
    panel.querySelector('#decorClear').addEventListener('click', clearAll);
    panel.querySelector('#decorResetOffice').addEventListener('click', resetOffice);
    panel.querySelector('#decorExport').addEventListener('click', exportPNG);
    panel.querySelector('#decorFold').addEventListener('click', () => setColumn(collapsed));

    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'Escape') { armedType = null; panel.querySelectorAll('.decor-item').forEach((x) => x.classList.remove('active')); select(null); }
      if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      if (e.key.toLowerCase() === 'r') rotateSelected();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); }
    });
  }

  function exportPNG() {
    try {
      core.renderer.render(core.scene, core.camera);
      const url = core.renderer.domElement.toDataURL('image/png');
      const b64 = url.split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      if (typeof window.downloadBlob === 'function') window.downloadBlob(blob, 'office-decor.png', 'image/png');
    } catch (err) { console.error('decor export failed', err); }
  }

  function installStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :root{--mono:'JetBrains Mono','Cascadia Code',Consolas,monospace}
      .theme-dark{--bg:#0d1220;--panel:#141b2b;--ink:#e7ecf6;--muted:#8b96ad;--line:#26324b;--nav:#080d18;--nav2:#101a2e;--shadow:0 12px 34px rgba(0,0,0,.5)}
      .theme-dark body{background:var(--bg);color:var(--ink)}
      .theme-dark .topbar{background:rgba(13,18,32,.92)}
      .theme-dark .search{background:#0f1728;color:#c3cde0;border-color:var(--line)}
      .theme-dark .role-select{background:#0f1728;color:var(--ink)}
      .theme-dark input,.theme-dark select,.theme-dark textarea{background:#0f1728;color:var(--ink);border-color:var(--line)}
      .decor-theme{border:1px solid var(--line);background:var(--panel);border-radius:7px;width:24px;height:24px;line-height:1;cursor:pointer;font-size:12px;color:var(--ink)}
      .decor-theme:hover{border-color:var(--primary)}
      .top-theme{width:34px;height:34px;border-radius:10px;font-size:15px}
      .ws3d-shell{grid-template-columns:240px minmax(340px,1fr) 300px var(--decor-w,236px)!important;transition:grid-template-columns .18s ease}
      @media (max-width:1420px){.ws3d-shell{grid-template-columns:205px minmax(320px,1fr) 268px var(--decor-w,226px)!important}}
      @media (max-width:1220px){.ws3d-shell{grid-template-columns:180px minmax(300px,1fr) 246px var(--decor-w,216px)!important}}
      .ws3d-canvas-wrap{position:relative!important;min-width:0}
      .decor-panel{display:flex;flex-direction:column;min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow);font-size:11px}
      .decor-panel.collapsed{justify-content:flex-start}
      .decor-vlabel{writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--mono);font-size:9px;letter-spacing:.2em;color:var(--muted);text-align:center;padding:14px 0;cursor:pointer;user-select:none}
      .decor-vlabel:hover{color:var(--primary)}
      .decor-head{padding:9px 10px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;background:var(--panel)}
      .decor-head b{font-size:10px;letter-spacing:.1em}
      .decor-autosave{font-family:var(--mono);font-size:8px;color:var(--green)}
      .decor-fold{border:1px solid var(--line);background:var(--panel);border-radius:5px;width:20px;height:20px;line-height:1;cursor:pointer;font-size:12px;color:var(--ink)}
      .decor-body{flex:1;display:flex;flex-direction:column;min-height:0}
      .decor-scroll{flex:1;overflow-y:auto;padding:9px 10px;display:flex;flex-direction:column;gap:6px}
      .decor-sub{font-family:var(--mono);font-size:8px;letter-spacing:.12em;color:var(--muted);margin-top:3px}
      .decor-subrow{display:flex;justify-content:space-between;align-items:center}
      .decor-reset{border:1px solid var(--line);background:var(--panel);border-radius:6px;padding:2px 7px;font-size:8px;font-weight:700;cursor:pointer;color:var(--ink)}
      .decor-reset:hover{border-color:var(--primary)}
      .decor-office-list{display:flex;flex-direction:column;gap:4px;max-height:170px;overflow-y:auto}
      .decor-room-form{display:flex;flex-direction:column;gap:5px;border:1px dashed var(--line);border-radius:9px;padding:7px}
      .decor-room-form input[type="text"],.decor-room-form>input{border:1px solid var(--line);background:#fbfcfe;border-radius:6px;padding:5px 7px;font-size:10px;color:var(--ink)}
      .theme-dark .decor-room-form>input{background:#0f1728}
      .decor-room-dims{display:flex;gap:5px;align-items:center}
      .decor-room-dims label{display:flex;align-items:center;gap:3px;font-size:8.5px;color:var(--muted);font-weight:700}
      .decor-room-dims input[type="number"]{width:38px;border:1px solid var(--line);background:#fbfcfe;border-radius:6px;padding:4px 5px;font-size:10px;color:var(--ink)}
      .theme-dark .decor-room-dims input[type="number"]{background:#0f1728}
      .decor-room-dims input[type="color"]{width:26px;height:26px;border:1px solid var(--line);border-radius:6px;padding:0;cursor:pointer}
      .decor-room-list{display:flex;flex-direction:column;gap:4px;max-height:130px;overflow-y:auto}
      .decor-tpls{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      .decor-tpl{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:7px 4px;font-size:10px;font-weight:700;cursor:pointer;color:var(--ink)}
      .decor-tpl:hover{border-color:var(--primary)}
      .decor-catalog{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      .decor-item{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:7px 5px;display:flex;flex-direction:column;gap:3px;cursor:pointer;text-align:left;align-items:center}
      .decor-item .di-ico{font-size:17px;line-height:1}
      .decor-item b{font-size:8.5px;color:var(--ink);font-weight:700;text-align:center}
      .decor-item.active,.decor-item:hover{border-color:var(--primary);background:rgba(90,103,242,.10)}
      .decor-swatches{display:flex;gap:4px;flex-wrap:wrap}
      .decor-swatch{width:21px;height:21px;border-radius:6px;border:2px solid #fff;outline:1px solid var(--line);cursor:pointer}
      .decor-swatch.active{outline:2px solid var(--primary)}
      .decor-hex{width:58px;border:1px solid var(--line);border-radius:6px;padding:4px 5px;font-family:var(--mono);font-size:10px;outline:none}
      .decor-co{border:1px solid var(--line);background:var(--panel);border-radius:6px;padding:4px 7px;font-size:8.5px;font-weight:700;cursor:pointer}
      .decor-brand{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
      .decor-placed-list{display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto}
      .decor-placed{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:7px;padding:5px 7px;cursor:pointer;background:var(--panel)}
      .decor-placed.sel{border-color:var(--primary);background:rgba(90,103,242,.10)}
      .theme-dark .decor-placed.sel{background:rgba(90,103,242,.20)}
      .decor-placed .dp-name{flex:1;font-size:9.5px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .decor-placed .dp-desk{font-family:var(--mono);font-size:7px;letter-spacing:.06em;color:var(--primary);border:1px solid var(--primary);border-radius:4px;padding:1px 4px}
      .decor-placed .dp-del{border:0;background:transparent;color:#e4515e;cursor:pointer;font-size:11px;padding:0}
      .decor-placed-empty{font-size:9px;color:var(--muted);line-height:1.5;border:1px dashed var(--line);border-radius:7px;padding:8px}
      .decor-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px}
      .decor-btn{border:1px solid var(--line);background:var(--panel);border-radius:7px;padding:6px 3px;font-size:8.5px;font-weight:700;cursor:pointer;color:var(--ink)}
      .decor-btn:hover{border-color:var(--primary)}
      .decor-btn.danger{color:#e4515e}
      .decor-btn.danger:hover{border-color:#e4515e}
      .decor-hint{font-family:var(--mono);font-size:8px;color:var(--muted);line-height:1.5;min-height:20px}
      .decor-foot{border-top:1px solid var(--line);background:var(--panel);padding:8px 10px;display:flex;flex-direction:column;gap:4px}
      .decor-foot > div:first-child{font-family:var(--mono);font-size:8px;color:var(--muted)}
      .decor-egress{font-family:var(--mono);font-size:8px;letter-spacing:.08em;padding:2px 6px;border-radius:6px;align-self:flex-start}
      .decor-egress.ok{background:#e6f7f0;color:var(--green)}
      .decor-egress.warn{background:#fdf1e3;color:var(--amber)}
      .decor-actbar{position:absolute;z-index:40;display:flex;gap:4px;background:#10161d;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:4px;box-shadow:0 6px 18px rgba(0,0,0,.35);pointer-events:auto}
      .decor-actbar button{border:0;background:transparent;color:#fff;font-size:13px;width:26px;height:26px;border-radius:6px;cursor:pointer}
      .decor-actbar button:hover{background:rgba(255,255,255,.14)}
      .decor-actbar button[data-act="del"]:hover{background:#e4515e}
      /* ---- full-app dark surfaces (auto-generated) ---- */
/* auto-generated by gen-dark-overrides.js — full-app dark surfaces */
.theme-dark .topbar .top-icon-btn,.theme-dark .topbar .date-control,.theme-dark .top-icon-btn:hover,.theme-dark .date-control:hover,.theme-dark .quick-create-tile,.theme-dark .interaction-drawer,.theme-dark .drawer-close,.theme-dark .notification-item,.theme-dark .search-result,.theme-dark .leave-calendar-row,.theme-dark .context-row,.theme-dark .notification-item:hover,.theme-dark .search-result:hover,.theme-dark .leave-calendar-row:hover,.theme-dark .modal,.theme-dark .tab,.theme-dark .messages,.theme-dark .bubble,.theme-dark .thread-item.active,.theme-dark .thread-item:hover,.theme-dark .quick-link,.theme-dark .policy,.theme-dark .org-node,.theme-dark .flow .step,.theme-dark .insight,.theme-dark .btn-ghost,.theme-dark .btn-ghost:hover,.theme-dark .task-column,.theme-dark .task-card,.theme-dark .task-actions button,.theme-dark .priv-card,.theme-dark .scope-pill,.theme-dark .access-banner,.theme-dark .settings-side,.theme-dark .settings-card,.theme-dark .settings-side small,.theme-dark .category-chip,.theme-dark .danger-zone,.theme-dark .owner-badge,.theme-dark .owner-lock-banner,.theme-dark .reports-kpi div,.theme-dark .decision-lab-card,.theme-dark .decision-result,.theme-dark .decision-score,.theme-dark .decision-metrics>div,.theme-dark .scenario-result,.theme-dark .scenario-fields select,.theme-dark .scenario-fields input,.theme-dark .decision-mini select,.theme-dark .decision-mini input,.theme-dark .mini-ai-answer,.theme-dark .signal-card,.theme-dark .ai-suggestions button,.theme-dark .ai-conversation,.theme-dark .ai-system,.theme-dark .ai-citations span,.theme-dark .ai-action-row button,.theme-dark .ai-composer,.theme-dark .ai-audit-card,.theme-dark .intel-command-panel,.theme-dark .intel-command-head,.theme-dark .intel-rail-card,.theme-dark .intel-rail-card select,.theme-dark .intel-status-grid,.theme-dark .intel-stat.accent,.theme-dark .smart-query-wrap,.theme-dark .query-mic,.theme-dark .prompt-ribbon button,.theme-dark .prompt-ribbon button:hover,.theme-dark .answer-capabilities span,.theme-dark .executive-answer,.theme-dark .query-echo,.theme-dark .result-metric,.theme-dark .rank-index,.theme-dark .evidence-row span,.theme-dark .answer-actions button,.theme-dark .data-table-mini .mini-head,.theme-dark .role-note,.theme-dark .top-quick button,.theme-dark .top-quick button:hover,.theme-dark .tool-tabs,.theme-dark .smart-card,.theme-dark .smart-card button,.theme-dark .capture-zone,.theme-dark .fun-challenge,.theme-dark .challenge-answers button,.theme-dark .challenge-answers button:hover,.theme-dark .challenge-answers button.wrong,.theme-dark .table th,.theme-dark .campaign-table th,.theme-dark .ws3d-shell > aside,.theme-dark .ws3d-template,.theme-dark .ws3d-template:hover,.theme-dark .ws3d-toolbar button,.theme-dark .ws3d-toolbar button:hover,.theme-dark .ws3d-view-toggle,.theme-dark .ws3d-view-toggle button.active,.theme-dark .ws3d-hud,.theme-dark .ws3d-stat-box,.theme-dark .ws3d-kpi,.theme-dark .ws3d-theme,.theme-dark .ws3d-activity-item,.theme-dark .ws3d-mgr-tabs,.theme-dark .ws3d-mgr-tabs button.active,.theme-dark .ws3d-mgr-emp-card,.theme-dark .ws3d-mgr-emp-card:hover,.theme-dark .ws3d-mgr-emp-actions button,.theme-dark .ws3d-mgr-emp-actions button:hover,.theme-dark .ws3d-mgr-emp-actions button.danger,.theme-dark .ws3d-mgr-emp-actions button.danger:hover,.theme-dark .ws3d-mgr-dept-row,.theme-dark .ws3d-mgr-form-row input,.theme-dark .ws3d-mgr-form-row select,.theme-dark .ws3d-mgr-banner{background:var(--panel);border-color:var(--line);color:var(--ink)}
.theme-dark .ws3d-hud{background:rgba(16,23,40,.94)}
.theme-dark .ws3d-view-toggle{background:#182238}
.theme-dark .ws3d-template .ws3d-t-icon,.theme-dark .ws3d-mgr-emp-card .ws3d-mgr-avatar{background:linear-gradient(135deg,#1a2340,#20294f)}
.theme-dark .ws3d-mgr-banner,.theme-dark .owner-lock-banner{background:linear-gradient(135deg,#33291a,#2b2418)}
.theme-dark .challenge-answers button.wrong,.theme-dark .ws3d-mgr-emp-actions button.danger,.theme-dark .ws3d-mgr-emp-actions button.danger:hover{background:rgba(228,81,94,.16)}
.theme-dark .table th,.theme-dark .campaign-table th{background:#18233a;color:#9fb0d0}
.theme-dark .table td,.theme-dark .campaign-table td{border-color:var(--line);color:var(--ink)}
.theme-dark .thread-item.active,.theme-dark .thread-item:hover,.theme-dark .scope-pill{background:rgba(90,103,242,.16)}
.theme-dark .top-icon-btn:hover,.theme-dark .date-control:hover{background:#182238}
.theme-dark input[style*="background"],.theme-dark select[style*="background"],.theme-dark textarea[style*="background"]{background:#0f1728 !important;border-color:var(--line) !important}
.theme-dark .gray{background:#1e2a3d}
      /* ---- UI comfort pass (dark mode + breathing room) ---- */
      .theme-dark .kpi{background:linear-gradient(145deg,#182238,#141b2b)}
      .theme-dark .seo-signal-card{background:linear-gradient(145deg,#16203a,#131a2c)}
      .theme-dark .table-wrap{background:var(--panel)}
      .theme-dark .table{background:var(--panel)}
      .theme-dark .table th{background:#18233a;color:#9fb0d0;border-color:var(--line)}
      .theme-dark .table td{border-color:var(--line);color:var(--ink)}
      .theme-dark .table tr:hover td{background:rgba(90,103,242,.07)}
      .theme-dark .btn-soft{box-shadow:none}
      .seo-kpis{gap:16px}
      .dashboard-card{padding:18px}
      .ws3d-label3d{font-size:9px;padding:3px 6px;line-height:1;max-width:92px;overflow:hidden;text-overflow:ellipsis}
      .ws3d-sub{letter-spacing:.1em}
    `;
    document.head.appendChild(style);
  }

  /* ---------- init ---------- */
  function styleRoom() {
    // make the office read as an enclosed room: glass walls + calmer grid
    const walls = [];
    (core.roomGroup.children || []).forEach((c) => {
      if (c.isMesh && c.geometry && c.geometry.type === 'BoxGeometry' && Math.abs(c.geometry.parameters.height - core.ROOM_H) < 0.6) walls.push(c);
      if (c.isGridHelper && c.material) { c.material.opacity = 0.2; c.material.transparent = true; }
    });
    walls.forEach((c) => { const m = c.material; m.transparent = true; m.opacity = 0.32; m.side = THREE.DoubleSide; m.depthWrite = false; });
    // the app only builds back+left walls; add front+right glass walls to close the room
    if (!core.roomGroup.__extraWalls && walls.length >= 2) {
      core.roomGroup.__extraWalls = true;
      const th = core.DECOR_THEMES[core.ws3dState.theme] || {};
      const gm = new THREE.MeshStandardMaterial({ color: th.wall || 0x8fa3d8, transparent: true, opacity: 0.22, roughness: 0.25, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false });
      const mk = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, core.ROOM_H, d), gm); m.position.set(x, core.ROOM_H / 2, z); core.roomGroup.add(m); };
      mk(core.ROOM_W, 0.15, 0, core.ROOM_D / 2);   // front
      mk(0.15, core.ROOM_D, core.ROOM_W / 2, 0);   // right
    }
  }

  function init() {
    if (inited) return;
    const attempt = () => {
      if (!window.__ws3dCore) return false;
      core = window.__ws3dCore;
      if (!core || !core.scene) return false;
      shell = document.querySelector('.ws3d-shell');
      if (!shell) return false;
      raycaster = new THREE.Raycaster();
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      ghost = new THREE.Group();
      ghost.visible = false;
      core.scene.add(ghost);
      const preview = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.9), new THREE.MeshBasicMaterial({ color: 0x5a67f2, transparent: true, opacity: 0.45 }));
      ghost.add(preview);
      hookFloorMat();
      buildPanel();
      buildActBar();
      // Starts collapsed so all three side panels (Layout, Activity, Office Decor)
      // are hidden by default — index.html's single "Show panels" header button
      // is what brings them all up together.
      setColumn(false);
      addThemeButtons();
      hookOfficeRebuild();
      restore();
      rebuild();
      rebuildRooms();
      updateCost();
      officeFresh = true;
      applyOfficeEdits();
      styleRoom();
      setFloorColor(floorColor);
      // friendlier default camera: lower, closer, less "god view"
      try {
        core.camera.position.set(8.6, 6.2, 10.8);
        core.controls.target.set(0, 0.5, 0);
        core.controls.update();
      } catch (_) {}
      window.__decorDbg = { applyOfficeEdits, renderOfficeList, renderPlaced, officeEdits: () => officeEdits, items: () => items.slice(), rooms: () => rooms.slice(), group: () => group, dragging: () => dragging, pickAt: (cx, cy) => { const r = core.renderer.domElement.getBoundingClientRect(); mouseNDC.x = ((cx - r.left) / r.width) * 2 - 1; mouseNDC.y = -((cy - r.top) / r.height) * 2 + 1; return pickItem(); } };
      const cv = core.renderer.domElement;
      cv.addEventListener('pointermove', onPointerMove);
      cv.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('pointerup', onPointerUp);
      inited = true;
      return true;
    };
    if (!attempt()) {
      const iv = setInterval(() => { if (attempt()) clearInterval(iv); }, 400);
      setTimeout(() => clearInterval(iv), 15000);
    }
    setTimeout(() => { if (core) { try { core.ensureInitialized(); } catch (_) {} resizeCanvas(); } }, 350);
  }

  const check = () => { if (document.getElementById('workspace3d') && document.getElementById('workspace3d').classList.contains('active')) init(); };
  window.addEventListener('load', check);
  const origNav = window.navigate;
  if (typeof origNav === 'function') {
    window.navigate = function (v) {
      if (typeof origNav === 'function') origNav(v);
      if (v === 'workspace3d') setTimeout(init, 250);
    };
  }
  setTimeout(check, 3000);
  // apply the persisted UI theme immediately, before any view is opened
  installStyles();
  let storedTheme = null;
  try { storedTheme = localStorage.getItem(THEME_KEY); } catch (_) {}
  document.documentElement.classList.toggle('theme-dark', storedTheme === 'dark');
})();
