import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const browserPackage = new URL('../.runtime/browser/package.json', import.meta.url);
const viewport = { width: 1440, height: 900 };

async function readStatus(origin, route) {
  const response = await fetch(origin + route, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  return response.json();
}

export async function verifyPortableBrowser(address, { isolated = false } = {}) {
  const url = new URL(address);
  if (!isolated || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.port === '8080' ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use --isolated with an HTTP 127.0.0.1 test port other than 8080 and temporary save data');
  }
  const origin = url.origin;
  const [health, moba] = await Promise.all([readStatus(origin, '/health'), readStatus(origin, '/moba/status')]);
  if (!health.ready || !health.platform?.ready || !moba.enabled || health.platform.rooms !== 0 || moba.rooms !== 0) {
    throw new Error('Browser smoke requires both modes enabled and no active rooms');
  }

  const pkg = process.env.OFFICE99_SMOKE_BROWSER_DIR
    ? path.join(path.resolve(process.env.OFFICE99_SMOKE_BROWSER_DIR), 'package.json')
    : browserPackage;
  const { chromium } = createRequire(pkg)('playwright');
  const errors = { page: 0, engine: 0 };
  const checks = [];
  let browser;
  let page;
  let stage = 'launch Chromium';
  function observe(target) {
    target.setDefaultTimeout(30000);
    target.on('pageerror', () => { errors.page++; });
    target.on('console', message => {
      const text = message.text();
      if (text.includes('SCRIPT ERROR') || text.startsWith('ERROR:')) errors.engine++;
    });
  }
  try {
    const args = ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'];
    if (process.platform === 'darwin' && process.env.CI) args.push('--use-gl=angle', '--use-angle=swiftshader');
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.OFFICE99_SMOKE_CHROMIUM || undefined,
      channel: process.env.OFFICE99_SMOKE_CHROMIUM ? undefined : 'chromium',
      args,
    });
    const context = await browser.newContext({ viewport });
    page = await context.newPage();
    observe(page);

    stage = 'load login and show both versions';
    await page.goto(origin);
    await page.waitForFunction(({ pve, moba }) => {
      const pveText = document.querySelector('#pve-version')?.textContent;
      const mobaText = document.querySelector('#moba-version')?.textContent;
      return pveText?.includes(pve) && mobaText?.includes(moba);
    }, { pve: health.build, moba: moba.version.replace(/^moba-/, '') });
    checks.push('dual version badges');
    const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
    if (!webgl) throw new Error('WebGL 2 unavailable in this browser environment');

    stage = 'register a disposable browser account';
    await page.locator('#auth-toggle').click();
    await page.locator('#username').fill(`browser-${randomBytes(7).toString('hex')}`);
    await page.locator('#password').fill(randomBytes(24).toString('base64url'));
    await page.locator('#display-name').fill('浏览器验证');
    await page.locator('#auth-submit').click();
    await page.locator('#moba-open').waitFor({ state: 'visible' });
    checks.push('login from public entry page');

    stage = 'start MOBA and render the arena';
    await page.locator('#moba-open').click();
    await page.locator('#create').click();
    await page.locator('#ready').click();
    await page.locator('#begin').click();
    await page.waitForFunction(() => {
      const d = window.mobaDiagnostics?.();
      return document.querySelector('#loading-title')?.textContent.includes('加载失败') ||
        (d?.frameReady && d.room?.status === 'running' && d.room.slots === 10 && d.state?.self);
    }, undefined, { timeout: 120000 });
    const started = await page.evaluate(() => window.mobaDiagnostics?.().frameReady);
    if (!started) throw new Error('Godot reported a loading failure');
    checks.push('MOBA Godot frame and 10-seat match');

    stage = 'move a MOBA hero with a canvas right click';
    const frame = page.locator('#game-frame');
    await frame.click({ position: { x: 720, y: 400 } });
    await page.keyboard.press('y');
    await page.waitForFunction(() => window.mobaRenderDiagnostics?.cameraLocked);
    const point = await page.evaluate(() => {
      const s = window.mobaDiagnostics().state;
      const hero = s.entities.find(entity => entity.id === s.selfId);
      return { x: hero.x, z: hero.z };
    });
    await frame.click({ position: { x: 860, y: 405 }, button: 'right' });
    await page.waitForFunction(before => {
      const s = window.mobaDiagnostics()?.state;
      const hero = s?.entities.find(entity => entity.id === s.selfId);
      return hero && Math.hypot(hero.x - before.x, hero.z - before.z) > 2;
    }, point, { timeout: 12000 });
    checks.push('MOBA camera lock and right-click movement');

    stage = 'return to the shared lobby';
    await page.locator('#menu-open').click();
    await page.locator('#exit-match').click();
    await page.locator('#create').waitFor({ state: 'visible' });
    await page.locator('#back').click();
    await page.locator('#mission-entry-primary').waitFor({state: 'visible'});
    checks.push('MOBA return to the shared lobby');
    // A fresh page keeps the PVE result independent of the GPU objects MOBA just released.
    const storageState = await context.storageState();
    await context.close();
    const pveContext = await browser.newContext({ viewport, storageState });
    page = await pveContext.newPage();
    observe(page);
    await page.goto(origin);
    stage = 'open the PVE onboarding room';
    await page.locator('#mission-entry-primary').click();
    await page.waitForFunction(() => window.tidalDiagnostics?.().room?.status === 'running');
    stage = 'render the PVE onboarding scene';
    await page.waitForFunction(() => {
      const d = window.tidalDiagnostics?.();
      return d?.workerReady && d.gameLoaded;
    }, undefined, { timeout: process.platform === 'darwin' && process.env.CI ? 240000 : 120000 });
    await page.locator('#game-enter').click();
    const pve = page.frames().find(candidate => new URL(candidate.url()).pathname === '/play.html');
    if (!pve) throw new Error('PVE game frame not found');
    checks.push('PVE Godot frame');

    stage = 'verify PVE pointer lock and keyboard movement';
    await pve.waitForFunction(() => {
      const c = JSON.parse(document.body.dataset.controlsState ?? '{}');
      return c.ready && !c.controlsBlocked && c.pointerLocked;
    }, undefined, { timeout: 15000 });
    const startingPosition = await pve.evaluate(() => {
      const { x, z } = JSON.parse(document.body.dataset.gameState);
      return { x, z };
    });
    await page.keyboard.down('d');
    await delay(700);
    await page.keyboard.up('d');
    await pve.waitForFunction(before => {
      const state = JSON.parse(document.body.dataset.gameState ?? '{}');
      return Math.hypot(state.x - before.x, state.z - before.z) > 0.3;
    }, startingPosition, { timeout: 10000 });
    checks.push('PVE pointer lock and keyboard movement');

    stage = 'check browser and engine errors';
    if (errors.page || errors.engine) {
      throw new Error(`page errors ${errors.page}, engine errors ${errors.engine}`);
    }
    return { passed: true, hostPlatform: process.platform, hostArch: process.arch, browser: 'Chromium', checks, errors };
  } catch (error) {
    const state = await page?.evaluate(() => ({
      frame: Boolean(document.querySelector('#game-frame')),
      frameReady: Boolean(window.mobaDiagnostics?.().frameReady),
      roomStatus: window.mobaDiagnostics?.().room?.status || null,
      runtimeFault: Boolean(window.mobaDiagnostics?.().runtimeFault),
      pveRoomStatus: window.tidalDiagnostics?.().room?.status || null,
      pveWorkerReady: Boolean(window.tidalDiagnostics?.().workerReady),
      pveLoadingMessage: document.querySelector('#game-loading b')?.textContent || null
    })).catch(() => undefined);
    console.error(JSON.stringify({stage, checks, errors, state}));
    throw new Error(`${stage}: ${error.message.split('\n')[0]}`);
  } finally {
    await browser?.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [origin, flag, ...extra] = process.argv.slice(2);
  if (!origin || flag !== '--isolated' || extra.length) {
    process.stderr.write('Usage: node tools/smoke-portable-browser.mjs <loopback-origin> --isolated\n');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await verifyPortableBrowser(origin, { isolated: true })));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
