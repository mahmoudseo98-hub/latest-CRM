'use strict';

const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApplication } = require('../src/app');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  console.error('Playwright is required for this optional browser smoke test. Install it with: npm install --save-dev playwright');
  process.exit(2);
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-for-all-e2e-'));
  const application = createApplication({ projectRoot: path.join(__dirname, '..'), dataDir, allowLan: false });
  const server = http.createServer(application.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  const externalRequests = [];

  page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) externalRequests.push(url);
  });

  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    assert.match(page.url(), /\/setup\.html$/);
    assert.equal(await page.locator('.st').count(), 7);

    await page.locator('#fCompanyName').fill('Browser QA Company');
    await page.locator('#fTagline').fill('Company Intelligence OS');
    await page.locator('#s0Next').click();
    await page.locator('#fOwnerName').fill('Browser Owner');
    await page.locator('#fOwnerId').fill('9001');
    await page.locator('#s1Next').click();
    await page.locator('#s2Next').click();
    await page.locator('#s3Next').click();
    await page.locator('#s4Next').click();
    await page.locator('#s5Next').click();
    await page.locator('#btnFinish').click();
    await page.waitForURL('**/launcher.html', { timeout: 8000 });

    await page.locator('#companyStrip').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.app-card').count(), 2);
    assert.equal((await page.locator('#coName').textContent()).trim(), 'Browser QA Company');

    await page.locator('[data-page="seo-for-all/index.html"]').click();
    await page.waitForURL('**/seo-for-all/index.html');
    await page.locator('#dashboard.view.active').waitFor();
    assert.equal(await page.locator('#nav button[data-view]').count(), 14);

    const modules = ['dashboard', 'organization', 'attendance', 'tasks', 'workspaces', 'projecttools', 'requests', 'discussions', 'performance', 'governance', 'reports', 'settings'];
    for (const module of modules) {
      await page.evaluate((id) => window.navigate(id), module);
      await page.locator(`#${module}.view.active`).waitFor();
    }

    await page.evaluate(() => window.navigate('tasks'));
    await page.locator('#newTaskButton').click();
    await page.locator('#taskTitle').fill('Browser smoke task');
    await page.locator('#taskModal .btn-primary').click();
    await page.locator('#todoTasks .task-card h5', { hasText: 'Browser smoke task' }).waitFor();

    await page.evaluate(() => window.navigate('workspace3d'));
    await page.locator('#workspace3d.view.active').waitFor();
    await page.locator('#ws3dCanvasWrap canvas').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.decor-item').first().waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.locator('.decor-item').count(), 12);
    assert.equal(await page.locator('.decor-tpl').count(), 4);
    const canvasBox = await page.locator('#ws3dCanvasWrap canvas').boundingBox();
    assert.ok(canvasBox && canvasBox.width >= 300 && canvasBox.height >= 300);
    await page.locator('.decor-tpl').first().click();
    await page.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem('seo-office-decor') || '{}').items?.length > 0; } catch (_) { return false; }
    });

    await page.locator('#roleSelect').selectOption('employee');
    await page.waitForFunction(() => document.querySelector('[data-view="workspace3d"]').classList.contains('locked'));
    assert.equal(await page.locator('#workspace3d.view.active').count(), 0);
    await page.evaluate(() => window.navigate('workspace3d'));
    assert.equal(await page.locator('#workspace3d.view.active').count(), 0);
    await page.locator('#roleSelect').selectOption('ceo');

    await page.locator('[data-theme-toggle]').first().click();
    assert.equal(await page.locator('html.theme-dark').count(), 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('html.theme-dark').count(), 1);

    await page.evaluate(() => window.desktopApi.navigate('devices.html'));
    await page.waitForURL('**/devices.html');
    await page.locator('#fType').selectOption('simulator');
    await page.locator('#fName').fill('Browser QA Simulator');
    await page.locator('#fSimMode').selectOption('manual');
    await page.locator('#addForm button[type="submit"]').click();
    await page.locator('.device', { hasText: 'Browser QA Simulator' }).waitFor();

    await page.evaluate(() => window.desktopApi.devices.simulatePunch('9901', 0));
    await page.locator('#enrollCard').waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(await page.locator('#eId').inputValue(), '9901');
    await page.locator('#eName').fill('Registered Browser Person');
    await page.locator('#eDept').fill('Marketing');
    await page.locator('#enrollForm button[type="submit"]').click();
    await page.locator('.person', { hasText: 'Registered Browser Person' }).waitFor();

    await page.evaluate(() => window.desktopApi.devices.simulatePunch('9901', 0));
    await page.locator('.punch.reg .pid', { hasText: 'Registered Browser Person' }).waitFor({ timeout: 8000 });

    assert.deepEqual(externalRequests, []);
    assert.deepEqual(pageErrors, []);
    console.log('E2E PASS: setup, launcher, all 13 modules, tasks, 3D/decor, RBAC, theme persistence, devices, SSE punches, and name enrollment.');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await application.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
