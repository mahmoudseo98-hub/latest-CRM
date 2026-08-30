'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const pages = ['launcher.html', 'setup.html', 'devices.html', 'seo-for-all/index.html', 'atelier/index.html'];

test('all HTML runtime assets are local, present, and free of Electron-only URLs', () => {
  for (const relative of pages) {
    const file = path.join(publicDir, relative);
    const html = fs.readFileSync(file, 'utf8');
    const markupOnly = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    assert.doesNotMatch(html, /app:\/\//i, `${relative} still contains an Electron app:// URL`);
    const attributes = [...markupOnly.matchAll(/\b(?:src|href)="([^"]+)"/gi)].map((match) => match[1]);
    for (const reference of attributes) {
      if (/^(?:data:|blob:|#|\/company-|\/api\/)/.test(reference) || /company-seed\.js$/.test(reference)) continue;
      assert.doesNotMatch(reference, /^https?:\/\//i, `${relative} has a remote runtime asset: ${reference}`);
      const target = path.resolve(path.dirname(file), reference.split(/[?#]/)[0]);
      assert.equal(fs.existsSync(target), true, `${relative} references missing asset ${reference}`);
    }
  }
});

test('inline classic and module scripts parse successfully', () => {
  for (const relative of pages) {
    const html = fs.readFileSync(path.join(publicDir, relative), 'utf8');
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
    scripts.forEach((match, index) => {
      const attributes = match[1] || '';
      let source = match[2] || '';
      if (/\bsrc=|type="importmap"/i.test(attributes) || !source.trim()) return;
      if (/type="module"/i.test(attributes)) source = source.replace(/^\s*import\s+[^;]+;\s*$/gm, '');
      assert.doesNotThrow(() => new vm.Script(source, { filename: `${relative}:inline-${index + 1}` }), `${relative} inline script ${index + 1} has invalid syntax`);
    });
  }
});

test('the preserved Company OS contains all 14 modules and required web bridges', () => {
  const html = fs.readFileSync(path.join(publicDir, 'seo-for-all/index.html'), 'utf8');
  const expected = ['dashboard', 'organization', 'attendance', 'tasks', 'workspaces', 'projecttools', 'requests', 'discussions', 'performance', 'ai', 'governance', 'reports', 'workspace3d', 'settings'];
  const navModules = [...html.matchAll(/<button[^>]+data-view="([^"]+)"/g)].map((match) => match[1]).filter((id) => expected.includes(id));
  assert.deepEqual(navModules, expected);
  navModules.forEach((id) => assert.match(html, new RegExp(`<section id="${id}" class="view`)));
  assert.match(html, /<script src="\.\.\/web-api\.js"><\/script>[\s\S]*<script src="\.\.\/company-seed\.js"><\/script>/);
  assert.match(html, /const roleConfig=/);
  assert.match(html, /function init3DWorkspace/);
  assert.match(html, /<script src="\.\.\/seo-decor\.js"><\/script>/);
});

test('launcher, setup, and devices pages load web-api before their page logic', () => {
  const requirements = {
    'launcher.html': 'launcher.js',
    'setup.html': 'setup.js',
    'devices.html': 'devices.js',
  };
  for (const [page, pageScript] of Object.entries(requirements)) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    assert.ok(html.indexOf('web-api.js') >= 0);
    assert.ok(html.indexOf('web-api.js') < html.indexOf(pageScript), `${page} must load web-api before ${pageScript}`);
  }

  const setupScript = fs.readFileSync(path.join(publicDir, 'setup.js'), 'utf8');
  const devicesScript = fs.readFileSync(path.join(publicDir, 'devices.js'), 'utf8');
  assert.match(setupScript, /state\.prefs\.autoBackup[\s\S]*api\.openDataFolder\(\)/, 'automatic backup must initiate a server-backup download');
  assert.doesNotMatch(setupScript + devicesScript, /fListenPort|devRowListen|rowPort2/, 'managed hosting must not expose a stale secondary HTTP listener port');
});
