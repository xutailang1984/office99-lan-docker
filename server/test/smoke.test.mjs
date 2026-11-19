import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const { WebSocket } = createRequire(new URL('../../server/package.json', import.meta.url))('ws');
const implementation = process.env.VOXEL_FISHING_SERVER_MODULE ? pathToFileURL(path.resolve(process.env.VOXEL_FISHING_SERVER_MODULE)) : new URL('../../server/server.mjs', import.meta.url);
const { createGameServer: createLegacyServer } = await import(implementation.href);
const createGameServer = options => createLegacyServer({ ...options, testLegacyModes: true });

// OS-assigned loopback ports can fall on Fetch's browser-denied port list.
// Native HTTP keeps these isolated tests valid for any ephemeral port.
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method ?? 'GET', headers: options.headers }, response => {
      let body = '';
      response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: { get: key => response.headers[key.toLowerCase()] }, text: async () => body, json: async () => JSON.parse(body) }));
      response.on('error', reject);
    });
    request.setTimeout(4000, () => request.destroy(new Error('temporary HTTP request timed out')));
    request.on('error', reject); request.end();
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = check(); if (result) return result; await sleep(20); }
  assert.fail(message);
}
async function connect(port, name, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const client = { ws, messages: [], state: null, welcome: null, send: message => ws.send(JSON.stringify(message)) };
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString()); client.messages.push(message);
    if (message.type === 'state') client.state = message;
    if (message.type === 'welcome') client.welcome = message;
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  client.send({ type: 'hello', name, token });
  await until(() => client.welcome || client.messages.find(m => m.code === 'ROOM_FULL'), 'join did not resolve');
  return client;
}
const me = client => client.state?.players.find(p => p.id === client.welcome?.playerId);
function aimAt(client, target) {
  const p = me(client), dx = target.x - p.x, dz = target.z - p.z;
  return { aimYaw: Math.atan2(-dx, -dz), aimPitch: Math.atan2((target.y ?? 0) + (target.radius ? 0.4 : 1) - p.y - 1.62, Math.hypot(dx, dz)) };
}
async function errorAction(client, action, code) {
  const index = client.messages.length;
  client.send(action);
  await until(() => client.messages.slice(index).some(m => m.code === code), `missing ${code}`);
}
async function moveToward(client, x, z, stopDistance = 0.15) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const player = me(client);
    const dx = x - player.x, dz = z - player.z, length = Math.hypot(dx, dz);
    if (length <= stopDistance) { client.send({ type: 'input', dx: 0, dz: 0, angle: 0 }); return; }
    client.send({ type: 'input', dx: dx / length, dz: dz / length, angle: 0 });
    await sleep(50);
  }
  assert.fail('movement failed to arrive');
}

test('LAN gameplay authority, room controls, hostile fish, shop, and durable progress', { timeout: 40000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'voxel-fishing-smoke-'));
  const webRoot = path.join(temporary, 'web'), saveFile = path.join(temporary, 'data', 'save.json');
  await mkdir(webRoot); await writeFile(path.join(webRoot, 'index.html'), '<title>Fixture</title>');
  await writeFile(path.join(temporary, 'private.txt'), 'private fixture');
  let server;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.ws.terminate();
    if (server) await server.stop();
    // Only delete the exact OS temporary directory created by this test.
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('voxel-fishing-smoke-'));
    await rm(temporary, { recursive: true, force: true });
  });
  const settings = { port: 0, host: '127.0.0.1', webRoot, saveFile, tickMs: 20, waitingMinMs: 30, waitingMaxMs: 30, random: () => 0 };
  server = await createGameServer(settings);
  const base = `http://127.0.0.1:${server.port}`;
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /Fixture/);
  assert.equal(page.headers.get('cross-origin-embedder-policy'), 'require-corp');
  // A port conflict must reject cleanly without leaving timers or an orphan server.
  await assert.rejects(createGameServer({ ...settings, port: server.port }), error => error.code === 'EADDRINUSE');
  assert.equal((await fetch(base + '/%2e%2e%2fprivate.txt')).status, 403);
  assert.equal((await fetch(base + '/health', { method: 'POST' })).status, 405);
  const a = await connect(server.port, '甲'); clients.push(a);
  const b = await connect(server.port, '乙'); clients.push(b);
  const c = await connect(server.port, '丙'); clients.push(c);
  const d = await connect(server.port, '丁'); clients.push(d);
  const full = await connect(server.port, '第五人'); clients.push(full);
  assert.ok(full.messages.some(m => m.code === 'ROOM_FULL'));
  await until(() => a.state?.players.length === 4, 'four players not synchronized');
  assert.equal(a.state.hostId, a.welcome.playerId);
  assert.equal(a.state.friendlyFire, false);
  await errorAction(b, { type: 'settings', friendlyFire: true }, 'HOST_ONLY');
  await errorAction(a, { type: 'cast', x: 20, z: 0 }, 'CAST_TOO_FAR');
  await errorAction(a, { type: 'cast', x: 3, z: 0 }, 'NOT_WATER');
  await errorAction(a, { type: 'sell' }, 'SHOP_TOO_FAR');
  // Client-supplied position, money, and equipment fields are never authoritative.
  a.send({ type: 'input', dx: 10000, dz: 0, angle: 0, x: 500, coins: 99999, rod: 5 });
  await sleep(260);
  assert.ok(me(a).x > 0 && me(a).x < 1.6); assert.equal(me(a).coins, 0); assert.equal(me(a).rod, 1);
  a.send({ type: 'input', dx: 0, dz: 0, angle: 0 });
  // Spawn protection must expire before checking real friendly-fire damage.
  await sleep(2800);
  a.send({ type: 'attack', ...aimAt(a, me(b)) }); await sleep(80); assert.equal(me(b).hp, 100);
  a.send({ type: 'settings', friendlyFire: true });
  await until(() => a.state.friendlyFire, 'host setting did not propagate');
  await sleep(460); a.send({ type: 'attack', ...aimAt(a, me(b)) });
  await until(() => me(b).hp === 78, 'enabled friendly fire did not cause server damage');
  a.send({ type: 'settings', friendlyFire: false });
  await until(() => a.state.friendlyFire === false, 'disabled friendly fire did not propagate');
  await moveToward(a, 12, 0);
  await errorAction(a, { type: 'sell' }, 'SHOP_TOO_FAR');
  for (let i = 0; i < 4; i++) {
    await sleep(1050);
    a.send({ type: 'input', dx: 0, dz: 0, angle: -Math.PI / 2 });
    a.send({ type: 'cast', x: 17, z: 0 });
    await until(() => me(a)?.cast?.phase === 'bite', 'fish did not bite');
    a.send({ type: 'reel' });
    await until(() => a.state.fish.length === 1, 'reeling did not spawn hostile fish');
    assert.equal(a.state.fish[0].ownerId, a.welcome.playerId);
    for (let hit = 0; hit < 3; hit++) {
      a.send({ type: 'attack', ...aimAt(a, a.state.fish[0]) }); await sleep(380);
    }
    await until(() => a.state.fish[0]?.state === 'loot', 'defeated fish did not become world loot');
    assert.equal(me(a).bag.length, i, 'combat automatically collected loot');
    await until(() => a.state.fish[0].y <= 0.14, 'loot did not settle');
    a.send({ type: 'pickup', fishId: a.state.fish[0].id });
    await until(() => me(a).bag.length === i + 1 && a.state.fish.length === 0, 'fish was not defeated and collected');
  }
  assert.equal(me(a).progress.caught, 4);
  assert.equal(a.state.tasks.landed, 4);
  await moveToward(a, 0, -6);
  await errorAction(a, { type: 'upgrade', coins: 99999 }, 'NOT_ENOUGH_COINS');
  a.send({ type: 'sell' });
  await until(() => me(a).coins === 60 && me(a).bag.length === 0, 'sell did not credit authoritative value including combos');
  assert.equal(a.state.tasks.sold, 4);
  a.send({ type: 'upgrade' });
  await until(() => me(a).rod === 2 && me(a).coins === 20, 'upgrade cost or level incorrect');
  assert.equal(me(a).progress.sold, 4); assert.equal(me(a).progress.earned, 60);
  const token = a.welcome.token, id = a.welcome.playerId;
  const reconnect = await connect(server.port, '甲', token); clients.push(reconnect);
  assert.equal(reconnect.welcome.playerId, id);
  await until(() => reconnect.state?.players.length === 4, 'reconnect displaced wrong number of players');
  assert.equal(me(reconnect).coins, 20);
  await server.flushSave();
  const rawSave = await readFile(saveFile, 'utf8');
  assert.equal(rawSave.includes(token), false, 'raw reconnect token must never be persisted');
  assert.equal(Object.keys(JSON.parse(rawSave).profiles).length, 4);
  reconnect.ws.close();
  await until(() => b.state.hostId === b.welcome.playerId, 'host was not transferred on disconnect');
  await errorAction(c, { type: 'settings', friendlyFire: true }, 'HOST_ONLY');
  b.send({ type: 'settings', friendlyFire: true });
  await until(() => b.state.friendlyFire, 'new host could not set room option');
  for (const client of clients) client.ws.terminate();
  await server.stop(); server = await createGameServer(settings);
  const restored = await connect(server.port, '甲', token); clients.push(restored);
  assert.equal(restored.welcome.playerId, id);
  assert.equal(me(restored).coins, 20); assert.equal(me(restored).rod, 2);
  assert.deepEqual(me(restored).progress, { caught: 4, sold: 4, earned: 60 });
  assert.equal(restored.state.tasks.landed, 4); assert.equal(restored.state.tasks.sold, 4);
  assert.equal(restored.state.friendlyFire, true);
});

test('corrupt save fails safely without replacing existing progress', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'voxel-fishing-smoke-'));
  const saveFile = path.join(temporary, 'save.json');
  t.after(async () => {
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('voxel-fishing-smoke-'));
    await rm(temporary, { recursive: true, force: true });
  });
  await writeFile(saveFile, 'broken save fixture');
  await assert.rejects(createGameServer({ port: 0, host: '127.0.0.1', webRoot: temporary, saveFile }), /存档读取失败/);
  assert.equal(await readFile(saveFile, 'utf8'), 'broken save fixture');
});
