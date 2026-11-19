import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer as createLegacyServer } from '../server.mjs';
const createGameServer = options => createLegacyServer({ ...options, testLegacyModes: true });
import { SnapshotStore } from '../survival/save-store.mjs';

function request(port, route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host:'127.0.0.1', port, path:route, ...options }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status:res.statusCode, body }));
    });
    req.on('error', reject); req.setTimeout(4000, () => req.destroy(Error('HTTP timeout'))); req.end();
  });
}
async function join(port, route, clients, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`);
  clients.push(ws);
  const welcome = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Join timeout')), 4000);
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'welcome') { clearTimeout(timer); resolve(message); }
    });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
  await once(ws, 'open'); ws.send(JSON.stringify({ type:'hello', name:'isolated', ...(token ? {token} : {}) }));
  return await welcome;
}

test('both game routes share health and authenticated shutdown, keep independent durable worlds, and reconnect after restart', {timeout:12000}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tidal-integration-'));
  const webRoot = path.join(directory, 'web'), saveFile = path.join(directory, 'data/save.json');
  await mkdir(webRoot); await writeFile(path.join(webRoot, 'index.html'), 'survival fixture');
  await writeFile(path.join(webRoot, 'classic.html'), 'classic fixture');
  const shutdownToken = randomBytes(32).toString('base64url'), clients = [];
  const settings = { host:'127.0.0.1', port:0, webRoot, saveFile, survival:true, shutdownToken };
  let server;
  t.after(async () => {
    for (const ws of clients) ws.terminate();
    if (server) await server.stop();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('tidal-integration-'));
    await rm(directory, {recursive:true,force:true});
  });
  server = await createGameServer(settings);
  const a = await join(server.port, '/ws', clients), b = await join(server.port, '/survival/ws', clients);
  assert.equal((await request(server.port, '/')).body, 'survival fixture');
  assert.equal((await request(server.port, '/classic.html')).body, 'classic fixture');
  const health = JSON.parse((await request(server.port, '/health')).body);
  assert.equal(health.ready, true); assert.equal(health.players, 2); assert.equal(health.classicPlayers, 1);
  assert.equal(health.survival.players, 1);
  assert.equal((await request(server.port, '/shutdown', {method:'POST'})).status, 403);
  const stopped = await request(server.port, '/shutdown', {method:'POST', headers:{'x-shutdown-token':shutdownToken}});
  assert.equal(stopped.status, 200); assert.equal(JSON.parse(stopped.body).saved, true);
  const classic = JSON.parse(await readFile(saveFile, 'utf8'));
  assert.equal(Object.keys(classic.profiles).length, 1);
  const survival = await new SnapshotStore(path.join(directory, 'data/survival')).load();
  assert.equal(Object.keys(survival.players).length, 1); assert.equal(survival.bank.credits, 60);
  assert.equal(survival.bank.materials, 40);
  await server.stop(); server = await createGameServer(settings);
  const returnedA = await join(server.port, '/ws', clients, a.token), returnedB = await join(server.port, '/survival/ws', clients, b.token);
  assert.equal(returnedA.playerId, a.playerId); assert.equal(returnedB.selfId, b.selfId);
  await server.stop();
  const resumed = await new SnapshotStore(path.join(directory, 'data/survival')).load();
  assert.equal(Object.keys(resumed.players).length, 1); assert.equal(resumed.bank.credits, 60);
});
