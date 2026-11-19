import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const { WebSocket } = createRequire(new URL('../../server/package.json', import.meta.url))('ws');

// Copy this file to final server/test/ for normal `npm test`, or set
// VOXEL_FISHING_SERVER_MODULE to the absolute final server.mjs path.
// Only temporary saves and random loopback ports are used. Credentials stay in memory.
const implementation = process.env.VOXEL_FISHING_SERVER_MODULE
  ? pathToFileURL(path.resolve(process.env.VOXEL_FISHING_SERVER_MODULE))
  : new URL('../../server/server.mjs', import.meta.url);
const { createGameServer: createLegacyServer } = await import(implementation.href);
const createGameServer = options => createLegacyServer({ ...options, testLegacyModes: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function until(check, message, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(15);
  }
  assert.fail(message);
}

async function harness(t, { bag = [], sold = 0, coins = 7 } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxel-fishing-regression-'));
  const webRoot = path.join(directory, 'web');
  const saveFile = path.join(directory, 'data', 'save.json');
  await mkdir(webRoot); await mkdir(path.dirname(saveFile));
  await writeFile(path.join(webRoot, 'index.html'), '<title>Regression fixture</title>');
  const token = randomBytes(32).toString('base64url');
  const key = createHash('sha256').update(token).digest('hex');
  const playerId = randomUUID();
  const original = {
    version: 1,
    room: { friendlyFire: false, tasks: { landed: sold + bag.length, sold, completed: Math.floor(sold / 10) } },
    profiles: {
      [key]: { id: playerId, name: '测试渔友', coins, rod: 2, bag,
        progress: { caught: sold + bag.length, sold, earned: sold * 12 } },
    },
  };
  await writeFile(saveFile, JSON.stringify(original), 'utf8');
  const servers = [], clients = [], requests = [], responses = [];
  const fixture = {
    directory, webRoot, saveFile, token, playerId, key, requests, responses,
    async start(options = {}) {
      const server = await createGameServer({ port: 0, host: '127.0.0.1', webRoot, saveFile,
        shutdownToken: '', world: { shop: { x: 0, z: 0 } }, ...options });
      servers.push(server); return server;
    },
    async connect(server, suppliedToken = token) {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      const client = { ws, welcome: null, state: null, messages: [], closeCode: null,
        send: message => ws.send(JSON.stringify(message)) };
      clients.push(client);
      ws.on('message', raw => {
        const message = JSON.parse(raw.toString()); client.messages.push(message);
        if (message.type === 'welcome') client.welcome = message;
        if (message.type === 'state') client.state = message;
      });
      ws.on('close', code => { client.closeCode = code; });
      ws.on('error', () => {});
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      client.send({ type: 'hello', name: '测试渔友', token: suppliedToken });
      await until(() => client.welcome || client.messages.some(message => message.type === 'error'), 'join did not complete');
      if (client.welcome) await until(() => client.state?.players.some(player => player.id === client.welcome.playerId), 'joined player missing from snapshot');
      return client;
    },
    async readSave() { return JSON.parse(await readFile(saveFile, 'utf8')); },
    async readProfile() {
      const saved = await fixture.readSave();
      assert.ok(saved.profiles[key], 'original identity missing from saved profiles');
      return saved.profiles[key];
    },
  };
  t.after(async () => {
    for (const response of responses) response.destroy();
    for (const request of requests) request.destroy();
    for (const client of clients) client.ws.terminate();
    for (const server of servers) await server.stop();
    // Resolve and verify the exact freshly-created temporary directory before deleting it.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('voxel-fishing-regression-'));
    await rm(directory, { recursive: true, force: true });
  });
  return fixture;
}

const player = client => client.state?.players.find(item => item.id === client.welcome?.playerId);
const baseURL = server => `http://127.0.0.1:${server.port}`;

test('nonempty basket survives restart; selling across ten persists shared quest completion', { timeout: 12000 }, async t => {
  const bag = [{ kind: '蓝鳍方鱼', value: 12 }, { kind: '赤尾方鱼', value: 20 }];
  const fixture = await harness(t, { bag, sold: 8 });
  let server = await fixture.start();
  const before = await fixture.connect(server);
  assert.deepEqual(player(before).bag, bag);
  assert.equal(player(before).rod, 2);
  await server.stop();

  server = await fixture.start();
  const after = await fixture.connect(server);
  assert.ok(after.welcome.playerId === fixture.playerId, 'restart changed original identity');
  assert.ok(after.welcome.token === fixture.token, 'restart changed the reconnect credential');
  assert.deepEqual(player(after).bag, bag);
  assert.equal(player(after).coins, 7);
  assert.equal(after.state.tasks.sold, 8);
  after.send({ type: 'sell' });
  await until(() => player(after).bag.length === 0 && player(after).coins === 39, 'basket sale did not use authoritative values');
  assert.equal(after.state.tasks.sold, 10);
  assert.equal(after.state.tasks.completed, 1);
  assert.equal(after.state.tasks.target, 20);
  assert.equal(player(after).progress.sold, 10);
  await server.stop();

  server = await fixture.start();
  const restored = await fixture.connect(server);
  assert.equal(player(restored).coins, 39);
  assert.deepEqual(player(restored).bag, []);
  assert.equal(player(restored).rod, 2);
  assert.equal(player(restored).progress.sold, 10);
  assert.equal(restored.state.tasks.completed, 1);
  assert.equal(restored.state.tasks.target, 20);
});

test('unknown old credential is rejected with 4003 without adding or replacing an identity', { timeout: 10000 }, async t => {
  const fixture = await harness(t, { bag: [{ kind: '金冠方鱼', value: 35 }], coins: 90 });
  const server = await fixture.start();
  const unknownCredential = randomBytes(32).toString('base64url');
  const unknown = await fixture.connect(server, unknownCredential);
  assert.ok(unknown.messages.some(message => message.code === 'UNKNOWN_PROFILE'), 'unknown credential must return UNKNOWN_PROFILE');
  assert.ok(unknown.welcome === null, 'rejected identity must never receive a replacement credential');
  await until(() => unknown.closeCode !== null, 'unknown identity socket did not close');
  assert.equal(unknown.closeCode, 4003);
  await server.flushSave();
  assert.equal(Object.keys((await fixture.readSave()).profiles).length, 1, 'unknown identity created a new saved profile');
  const existing = await fixture.connect(server);
  assert.ok(existing.welcome.playerId === fixture.playerId, 'unknown join changed original player identity');
  assert.ok(existing.welcome.token === fixture.token, 'unknown join replaced original credential');
  assert.equal(player(existing).coins, 90);
  assert.equal(player(existing).bag.length, 1);
  assert.equal(existing.state.players.length, 1);
});

test('same identity replaces its old socket with 4001 while preserving host, basket, and credential', { timeout: 10000 }, async t => {
  const fixture = await harness(t, { bag: [{ kind: '赤尾方鱼', value: 20 }], coins: 61 });
  const server = await fixture.start();
  const oldClient = await fixture.connect(server);
  const newClient = await fixture.connect(server);
  await until(() => oldClient.closeCode !== null, 'superseded connection did not close');
  assert.equal(oldClient.closeCode, 4001, 'client needs a distinct non-retryable replacement code');
  assert.ok(newClient.welcome.playerId === fixture.playerId, 'replacement changed player identity');
  assert.ok(newClient.welcome.token === fixture.token, 'replacement changed reconnect credential');
  assert.ok(newClient.state.hostId === fixture.playerId, 'replacement lost room host rights');
  assert.equal(newClient.state.players.length, 1);
  assert.equal(player(newClient).coins, 61);
  assert.equal(player(newClient).bag.length, 1);
  newClient.send({ type: 'settings', friendlyFire: true });
  await until(() => newClient.state.friendlyFire, 'replacement host cannot change settings');
  await server.flushSave();
  const saved = await fixture.readSave();
  assert.equal(Object.keys(saved.profiles).length, 1);
  assert.equal(saved.room.friendlyFire, true);
});

test('stop persists the latest sale before disconnecting players, even during a paused large download', { timeout: 12000 }, async t => {
  const fixture = await harness(t, { bag: [{ kind: '蓝鳍方鱼', value: 12 }], coins: 0 });
  // A sparse file is enough to keep the HTTP stream open without allocating a large buffer.
  const largeFile = await open(path.join(fixture.webRoot, 'slow.pck'), 'w');
  await largeFile.truncate(32 * 1024 * 1024); await largeFile.close();
  const server = await fixture.start();
  const client = await fixture.connect(server);
  await new Promise((resolve, reject) => {
    const request = http.get(baseURL(server) + '/slow.pck', response => {
      fixture.responses.push(response); response.pause();
      if (response.statusCode !== 200) reject(new Error('large download fixture was not served'));
      else resolve();
    });
    fixture.requests.push(request); request.on('error', reject);
  });
  client.send({ type: 'sell' });
  await until(() => player(client).coins === 12, 'sale was not accepted before stop');
  const stopping = server.stop();
  await until(() => client.closeCode !== null, 'stop did not disconnect the player after saving');
  const saved = await fixture.readProfile();
  assert.equal(saved.coins, 12, 'players were disconnected before the latest progress reached disk');
  assert.deepEqual(saved.bag, []);
  await Promise.race([
    stopping,
    delay(4500).then(() => { throw new Error('stop did not enforce a bounded HTTP shutdown'); }),
  ]);
});

test('health identifies the service; local shutdown rejects missing/wrong tokens and any Origin, then saves before 200', { timeout: 12000 }, async t => {
  const fixture = await harness(t, { bag: [{ kind: '赤尾方鱼', value: 20 }], coins: 1 });
  const shutdownToken = randomBytes(32).toString('base64url');
  const server = await fixture.start({ shutdownToken });
  const client = await fixture.connect(server);
  const url = baseURL(server);
  const health = await (await fetch(url + '/health')).json();
  assert.equal(health.service, 'voxel-fishing');
  assert.equal(health.pid, process.pid);
  assert.equal(health.ready, true);
  for (const headers of [
    {},
    { 'X-Shutdown-Token': randomBytes(32).toString('base64url') },
    { 'X-Shutdown-Token': shutdownToken, Origin: url },
    { 'X-Shutdown-Token': shutdownToken, Origin: 'null' },
  ]) {
    const refused = await fetch(url + '/shutdown', { method: 'POST', headers });
    assert.ok([401, 403].includes(refused.status), 'unauthorized shutdown was not rejected');
    await refused.text();
    const stillAlive = await (await fetch(url + '/health')).json();
    assert.equal(stillAlive.ready, true, 'refused request changed server readiness');
  }
  const getShutdown = await fetch(url + '/shutdown', { headers: { 'X-Shutdown-Token': shutdownToken } });
  assert.ok([404, 405].includes(getShutdown.status), 'shutdown should require POST');
  await getShutdown.text();
  client.send({ type: 'sell' });
  await until(() => player(client).coins === 21, 'sale was not accepted before shutdown');
  const accepted = await fetch(url + '/shutdown', { method: 'POST', headers: { 'X-Shutdown-Token': shutdownToken } });
  assert.equal(accepted.status, 200);
  await accepted.text();
  const saved = await fixture.readProfile();
  assert.equal(saved.coins, 21, 'shutdown acknowledged before committing the latest progress');
  assert.deepEqual(saved.bag, []);
  await until(() => client.closeCode !== null, 'successful shutdown did not close gameplay connections');
});

test('shutdown stays disabled when no sufficiently strong server token is configured', { timeout: 10000 }, async t => {
  const fixture = await harness(t);
  for (const shutdownToken of ['', 'short']) {
    const server = await fixture.start({ shutdownToken });
    const response = await fetch(baseURL(server) + '/shutdown', { method: 'POST', headers: { 'X-Shutdown-Token': shutdownToken } });
    assert.ok([401, 403].includes(response.status), 'empty or short configured token enabled shutdown');
    await response.text();
    const health = await (await fetch(baseURL(server) + '/health')).json();
    assert.equal(health.ready, true);
    await server.stop();
  }
});
