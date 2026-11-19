import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer as createLegacyServer } from '../server.mjs';
const createGameServer = options => createLegacyServer({ ...options, testLegacyModes: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await sleep(15); }
  assert.fail(label);
}
async function fixture(t, { users = 1, coins = 200, weapons, bag = [], landed = 0, random = () => 0 } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxel-fishing-v02-'));
  const webRoot = path.join(directory, 'web'), saveFile = path.join(directory, 'save.json');
  await mkdir(webRoot);
  const identities = Array.from({ length: users }, (_, index) => {
    const token = randomBytes(32).toString('base64url');
    const profile = { id: randomUUID(), name: `测试渔友${index}`, coins, rod: 1, bag: structuredClone(bag), progress: { caught: bag.length, sold: 0, earned: 0 } };
    if (weapons) profile.weapons = [...weapons];
    return { token, key: createHash('sha256').update(token).digest('hex'), profile };
  });
  await writeFile(saveFile, JSON.stringify({ version: 1, room: { friendlyFire: false, tasks: { landed, sold: 0, completed: 0 } },
    profiles: Object.fromEntries(identities.map(identity => [identity.key, identity.profile])) }));
  const servers = [], clients = [];
  const f = { directory, webRoot, saveFile, identities, clients, server: null,
    async start() {
      f.server = await createGameServer({ port: 0, host: '127.0.0.1', webRoot, saveFile, shutdownToken: '',
        waitingMinMs: 40, waitingMaxMs: 40, random, world: { spawn: { x: 11, z: 0 }, shop: { x: 11, z: 0 } } });
      servers.push(f.server); return f.server;
    },
    async join(index = 0) {
      const ws = new WebSocket(`ws://127.0.0.1:${f.server.port}/ws`);
      const client = { ws, welcome: null, state: null, messages: [], index, send: value => ws.send(JSON.stringify(value)) };
      clients.push(client);
      ws.on('message', raw => {
        const message = JSON.parse(raw.toString()); client.messages.push(message);
        if (message.type === 'welcome') client.welcome = message;
        if (message.type === 'state') client.state = message;
      });
      ws.on('error', () => {});
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      client.send({ type: 'hello', name: identities[index].profile.name, token: identities[index].token });
      await until(() => client.welcome && client.state, 'fixture player did not join');
      return client;
    },
    me(client) { return f.server.snapshot().players.find(player => player.id === client.welcome.playerId); },
    fish(id) { return f.server.snapshot().fish.find(item => item.id === id); },
    async save() { await f.server.flushSave(); return JSON.parse(await readFile(saveFile, 'utf8')); },
  };
  t.after(async () => {
    for (const client of clients) client.ws.terminate();
    // Drain legacy disconnect writes before removing this fixture directory.
    for (const server of servers) { await server.stop(); await server.flushSave(); }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('voxel-fishing-v02-'));
    await rm(directory, { recursive: true, force: true });
  });
  await f.start(); return f;
}
async function rejects(client, message, code) {
  const start = client.messages.length; client.send(message);
  await until(() => client.messages.slice(start).some(item => item.type === 'error' && item.code === code), `expected ${code}`);
}
function aimAt(f, client, target) {
  const p = f.me(client), dx = target.x - p.x, dz = target.z - p.z;
  const targetY = (target.y ?? 0) + (target.boss ? 0.9 : target.radius ? 0.4 : 1);
  return { aimYaw: Math.atan2(-dx, -dz), aimPitch: Math.atan2(targetY - p.y - 1.62, Math.hypot(dx, dz)) };
}
function attackAt(f, client, target, extra = {}) { client.send({ type: 'attack', ...aimAt(f, client, target), ...extra }); }
async function moveTo(f, client, x, z, tolerance = 0.5) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const p = f.me(client), dx = x - p.x, dz = z - p.z, length = Math.hypot(dx, dz);
    if (length <= tolerance) { client.send({ type: 'input', dx: 0, dz: 0, angle: -Math.PI / 2 }); await sleep(110); return; }
    client.send({ type: 'input', dx: dx / length, dz: dz / length, angle: -Math.PI / 2, sprint: true }); await sleep(55);
  }
  assert.fail('authoritative movement did not reach target');
}
async function castFish(f, client, manual = false) {
  const before = new Set(f.server.snapshot().fish.map(item => item.id));
  client.send({ type: 'input', dx: 0, dz: 0, angle: -Math.PI / 2, pitch: 0 });
  client.send({ type: 'cast', x: 17, z: 0, power: 1 });
  await until(() => f.me(client).cast?.phase === 'bite', 'fish did not bite');
  client.send(manual ? { type: 'reel', held: true } : { type: 'reel' });
  await until(() => f.me(client).cast?.phase === 'reeling', 'bite did not enter reeling phase');
  if (manual) {
    client.send({ type: 'reel', held: false });
    await sleep(160); const paused = f.me(client).cast.progress;
    await sleep(240); assert.equal(f.me(client).cast.progress, paused, 'released reeling advanced progress');
    while (f.me(client).cast) {
      client.send({ type: 'input', dx: 0, dz: 0, angle: -Math.PI / 2, reeling: true }); await sleep(90);
    }
  }
  await until(() => f.server.snapshot().fish.some(item => !before.has(item.id)), 'completed reeling did not land a fish');
  return f.server.snapshot().fish.find(item => !before.has(item.id));
}
async function finishWithFists(f, client, id) {
  for (let count = 0; count < 8 && f.fish(id)?.hp > 0; count++) {
    const target = f.fish(id);
    if (Math.hypot(target.x - f.me(client).x, target.z - f.me(client).z) > 2.4) await moveTo(f, client, target.x - 1.3, target.z);
    attackAt(f, client, f.fish(id)); await sleep(370);
  }
  await until(() => f.fish(id)?.state === 'loot', 'fish did not become explicit loot');
}

test('old saves preserve their basket; weapon ownership, prices, ammo, reload and migration persist', { timeout: 15000 }, async t => {
  const legacyBag = [{ kind: '旧渔获', value: 31 }];
  const f = await fixture(t, { coins: 200, bag: legacyBag }); let a = await f.join();
  assert.deepEqual(f.me(a).weapons, ['fists']); assert.equal(f.me(a).weapon, 'rod');
  await rejects(a, { type: 'equip', weapon: 'pistol' }, 'WEAPON_NOT_OWNED');
  a.send({ type: 'buy_weapon', weapon: 'knife', price: 0 });
  await until(() => f.me(a).coins === 164, 'knife did not cost exactly 36');
  a.send({ type: 'buy_weapon', weapon: 'pistol', price: 0 });
  await until(() => f.me(a).coins === 74, 'pistol did not cost exactly 90');
  await rejects(a, { type: 'buy_weapon', weapon: 'pistol' }, 'ALREADY_OWNED');
  a.send({ type: 'equip', weapon: 'pistol' });
  await until(() => f.me(a).weapon === 'pistol', 'owned pistol did not equip');
  for (let shot = 0; shot < 6; shot++) { a.send({ type: 'attack', aimYaw: Math.PI / 2, aimPitch: 0, damage: 99999 }); await sleep(260); }
  assert.equal(f.me(a).ammo, 0);
  await rejects(a, { type: 'attack', aimYaw: 0, aimPitch: 0 }, 'EMPTY_MAGAZINE');
  a.send({ type: 'reload' });
  await until(() => f.me(a).reloadRemaining > 0, 'reload did not start');
  await rejects(a, { type: 'attack', aimYaw: 0, aimPitch: 0 }, 'RELOADING');
  await sleep(400); assert.equal(f.me(a).ammo, 0, 'reload refilled ammunition prematurely');
  await until(() => f.me(a).ammo === 6 && f.me(a).reloadRemaining === 0, 'reload did not complete');
  await f.server.stop(); await f.start(); a = await f.join();
  assert.equal(f.me(a).coins, 74); assert.equal(f.me(a).rod, 1);
  assert.deepEqual(f.me(a).bag, legacyBag);
  assert.deepEqual(f.me(a).weapons, ['fists', 'knife', 'pistol']);
  assert.equal(f.server.snapshot().tasks.bossDefeated, 0);
});

test('reeling requires held progress or keyboard auto-reel; aimed melee rejects misses, distance and forged damage', { timeout: 18000 }, async t => {
  const f = await fixture(t); const a = await f.join();
  const target = await castFish(f, a, true);
  await rejects(a, { type: 'attack', damage: 99999, targetId: target.id }, 'INVALID_AIM');
  const hp = f.fish(target.id).hp;
  const front = aimAt(f, a, f.fish(target.id));
  a.send({ type: 'attack', aimYaw: front.aimYaw + Math.PI, aimPitch: 0 }); await sleep(360);
  assert.equal(f.fish(target.id).hp, hp, 'backward attack hit a fish');
  attackAt(f, a, f.fish(target.id), { damage: 99999, targetId: 'forged', heavy: true, charge: 1 });
  await until(() => f.fish(target.id).hp < hp, 'forward melee did not hit');
  assert.equal(f.fish(target.id).hp, hp - 22, 'client forged damage or charge was trusted');
  attackAt(f, a, f.fish(target.id)); await sleep(90);
  assert.equal(f.fish(target.id).hp, hp - 22, 'cooldown accepted repeated attacks');
  await moveTo(f, a, 6, 0);
  const before = f.fish(target.id).hp;
  attackAt(f, a, f.fish(target.id)); await sleep(350);
  assert.equal(f.fish(target.id).hp, before, 'out-of-range melee hit');
  a.send({ type: 'cast', x: 15, z: 0 });
  await until(() => f.me(a).cast !== null, 'second cast failed');
  a.send({ type: 'cancel_cast' }); await until(() => f.me(a).cast === null, 'cancel_cast did not release line');
});

test('defeated fish remain loot; only one player can collect; style value and basket survive restart', { timeout: 14000 }, async t => {
  const f = await fixture(t, { users: 2 }); const a = await f.join(0), b = await f.join(1);
  const target = await castFish(f, a);
  await finishWithFists(f, a, target.id);
  assert.equal(f.me(a).bag.length + f.me(b).bag.length, 0, 'kill automatically added fish to a basket');
  const value = f.fish(target.id).lootValue;
  assert.equal(value, 15);
  assert.ok(f.fish(target.id).styleLabels.includes('连续命中'));
  attackAt(f, a, f.fish(target.id), { damage: 99999 }); await sleep(380);
  assert.equal(f.fish(target.id).lootValue, value, 'attacking a corpse changed its price');
  await until(() => f.fish(target.id).y <= 0.14, 'loot did not settle');
  await moveTo(f, a, 6, 0);
  await rejects(a, { type: 'pickup', fishId: target.id }, 'PICKUP_TOO_FAR');
  await moveTo(f, a, 11, 0);
  for (const client of [a, b]) client.send({ type: 'pickup', fishId: target.id, value: 99999 });
  await until(() => !f.fish(target.id), 'loot was not collected');
  assert.equal(f.me(a).bag.length + f.me(b).bag.length, 1, 'concurrent pickup duplicated the fish');
  assert.equal(f.me(a).progress.caught + f.me(b).progress.caught, 1);
  const winner = f.me(a).bag.length ? a : b;
  assert.equal(f.me(winner).bag[0].value, value);
  await rejects(winner, { type: 'pickup', fishId: target.id }, 'NOT_LOOT');
  const saved = await f.save(), winnerIndex = winner.index;
  const entry = saved.profiles[f.identities[winnerIndex].key].bag[0];
  await f.server.stop(); await f.start(); const restored = await f.join(winnerIndex);
  assert.deepEqual(f.me(restored).bag[0], entry);
});

test('knife damage and pistol cooldown stay distinct; initial fishing launch grants no aerial bonus', { timeout: 10000 }, async t => {
  const f = await fixture(t, { weapons: ['fists', 'knife', 'pistol'] }); const a = await f.join();
  const target = await castFish(f, a);
  a.send({ type: 'equip', weapon: 'knife' }); attackAt(f, a, f.fish(target.id));
  await until(() => f.fish(target.id).hp === 18, 'knife did not deal exactly 32 damage');
  a.send({ type: 'equip', weapon: 'pistol' }); attackAt(f, a, f.fish(target.id));
  await sleep(110);
  assert.equal(f.me(a).ammo, 6, 'weapon switching bypassed global attack cooldown');
  assert.equal(f.fish(target.id).hp, 18);
  await sleep(320); attackAt(f, a, f.fish(target.id));
  await until(() => f.fish(target.id).state === 'loot', 'pistol follow-up did not kill');
  assert.equal(f.me(a).ammo, 5);
  assert.equal(f.fish(target.id).styleLabels.includes('空中终结'), false, 'initial fishing launch improperly granted an aerial finisher bonus');
  assert.equal(f.fish(target.id).lootValue, 12);
});

test('charged uppercut creates authoritative airborne finish; jump height and sprint remain bounded', { timeout: 14000 }, async t => {
  const f = await fixture(t, { weapons: ['fists', 'pistol'] }); const a = await f.join();
  a.send({ type: 'jump', y: 100, vy: 100 });
  await until(() => f.me(a).y > 0.1, 'jump did not raise player');
  await sleep(250); assert.ok(f.me(a).y <= 1.1, 'jump accepted forged height');
  await until(() => f.me(a).y === 0, 'jump did not land');
  const x = f.me(a).x;
  a.send({ type: 'input', dx: -1000, dz: 0, angle: -Math.PI / 2, sprint: true, speed: 10000 });
  await sleep(210); a.send({ type: 'input', dx: 0, dz: 0, angle: -Math.PI / 2 });
  assert.ok(x - f.me(a).x < 2.1 && x - f.me(a).x > 0.6, 'sprint did not use bounded authoritative speed');
  await moveTo(f, a, 11, 0, 0.3);
  const target = await castFish(f, a);
  await until(() => f.fish(target.id).y <= 0.14, 'initial throw did not land');
  a.send({ type: 'charge', active: true }); await sleep(720); a.send({ type: 'charge', active: false });
  attackAt(f, a, f.fish(target.id), { heavy: true });
  await until(() => f.fish(target.id).y > 0.5 && f.fish(target.id).hp < 50, 'charged uppercut did not launch fish');
  a.send({ type: 'equip', weapon: 'pistol' }); await sleep(570);
  attackAt(f, a, f.fish(target.id));
  await until(() => f.fish(target.id)?.state === 'loot', 'airborne pistol finish did not kill');
  assert.ok(f.fish(target.id).styleLabels.includes('空中终结'));
  assert.equal(f.fish(target.id).lootValue, 18);
});

test('grab is exclusive and distance checked; throw creates an air finish and owner disconnect preserves collaborative combat', { timeout: 14000 }, async t => {
  const f = await fixture(t, { users: 3, weapons: ['fists', 'pistol'] });
  const a = await f.join(0), b = await f.join(1), far = await f.join(2);
  const target = await castFish(f, a);
  await rejects(far, { type: 'grab', fishId: target.id }, 'GRAB_TOO_FAR');
  a.send({ type: 'grab', fishId: target.id });
  await until(() => f.me(a).heldFishId === target.id && f.fish(target.id).state === 'held', 'close grab failed');
  await rejects(b, { type: 'grab', fishId: target.id }, 'FISH_HELD');
  await sleep(160);
  a.send({ type: 'throw', aimYaw: -Math.PI / 2, aimPitch: 0.5 });
  await until(() => f.me(a).heldFishId === null && f.fish(target.id).state === 'airborne' && f.fish(target.id).y > 1.2, 'throw did not create a physical airborne fish');
  a.send({ type: 'equip', weapon: 'pistol' }); await sleep(100); attackAt(f, a, f.fish(target.id));
  await until(() => f.fish(target.id).hp === 20, 'first contributor did not hit');
  a.ws.close(); await until(() => f.server.snapshot().players.length === 2, 'owner did not disconnect');
  assert.ok(f.fish(target.id), 'owner disconnect deleted the fish');
  b.send({ type: 'equip', weapon: 'pistol' }); await sleep(100); attackAt(f, b, f.fish(target.id));
  await until(() => f.fish(target.id)?.state === 'loot', 'teammate could not finish owner-disconnected fish');
  assert.ok(f.fish(target.id).styleLabels.includes('空中终结'));
  assert.ok(f.fish(target.id).styleLabels.includes('多人助攻'));
  assert.equal(f.fish(target.id).lootValue, 21);
});

test('friendly fire defaults off and enabled aim hits only one nearest teammate', { timeout: 11000 }, async t => {
  const f = await fixture(t, { users: 3 }); const a = await f.join(0), b = await f.join(1), c = await f.join(2);
  await sleep(3050);
  attackAt(f, a, f.me(b)); await sleep(360);
  assert.equal(f.me(b).hp, 100); assert.equal(f.me(c).hp, 100);
  await rejects(b, { type: 'settings', friendlyFire: true }, 'HOST_ONLY');
  a.send({ type: 'settings', friendlyFire: true }); await until(() => f.server.snapshot().friendlyFire, 'host setting did not apply');
  attackAt(f, a, f.me(b)); await until(() => f.me(b).hp === 78, 'enabled aimed damage did not hit teammate');
  assert.equal(f.me(c).hp, 100, 'single-target strike hurt an unrelated teammate');
  a.send({ type: 'settings', friendlyFire: false }); await sleep(360); attackAt(f, a, f.me(b)); await sleep(100);
  assert.equal(f.me(b).hp, 78, 'disabled friendly fire continued applying damage');
});

test('teammates can shoot suspended live fish and the hit releases both holding references', { timeout: 10000 }, async t => {
  const f = await fixture(t, { users: 2, weapons: ['fists', 'pistol'] });
  const holder = await f.join(0), shooter = await f.join(1);
  const target = await castFish(f, holder);
  holder.send({ type: 'grab', fishId: target.id });
  await until(() => f.me(holder).heldFishId === target.id, 'suspended-shot setup failed');
  await sleep(150);
  shooter.send({ type: 'equip', weapon: 'pistol' }); await sleep(110);
  attackAt(f, shooter, f.fish(target.id));
  await until(() => f.fish(target.id).hp === 20, 'aimed shot could not hit a suspended live fish');
  assert.equal(f.me(holder).heldFishId, null, 'hit left a stale holder reference');
  assert.equal(f.fish(target.id).heldById, null, 'hit left a stale fish holding reference');
  assert.notEqual(f.fish(target.id).state, 'held', 'held transform overwrote hit reaction');
  assert.ok(f.server.snapshot().protocolVersion === 2 && f.server.snapshot().build === '0.2.0');
});

test('full baskets cannot consume loot; disconnect releases held fish for other players', { timeout: 14000 }, async t => {
  const bag = Array.from({ length: 30 }, () => ({ kind: '旧渔获', value: 12 }));
  const f = await fixture(t, { users: 2, bag }); const a = await f.join(0), b = await f.join(1);
  b.send({ type: 'sell' }); await until(() => f.me(b).bag.length === 0, 'fixture helper could not free basket');
  const target = await castFish(f, b);
  b.send({ type: 'grab', fishId: target.id }); await until(() => f.me(b).heldFishId === target.id, 'held-disconnect setup failed');
  b.ws.close(); await until(() => !f.fish(target.id).heldById, 'disconnect did not release grabbed fish');
  await finishWithFists(f, a, target.id);
  await until(() => f.fish(target.id).y <= 0.14, 'loot did not land');
  await rejects(a, { type: 'pickup', fishId: target.id }, 'BAG_FULL');
  assert.ok(f.fish(target.id), 'full basket deleted world loot');
  assert.equal(f.me(a).bag.length, 30);
});

test('boss challenge enforces landed gate and single boss, advertises warning, rewards defeat and cooldown', { timeout: 23000 }, async t => {
  const f = await fixture(t, { users: 4, landed: 2, weapons: ['fists', 'pistol'] });
  const users = []; for (let i = 0; i < 4; i++) users.push(await f.join(i)); const a = users[0];
  await rejects(a, { type: 'interact' }, 'CHALLENGE_LOCKED');
  await castFish(f, a);
  assert.equal(f.server.snapshot().tasks.landed, 3);
  a.send({ type: 'interact' });
  await until(() => f.server.snapshot().fish.some(item => item.boss), 'unlocked challenge did not create boss');
  const bossId = f.server.snapshot().fish.find(item => item.boss).id;
  assert.equal(f.fish(bossId).maxHp, 520);
  await rejects(a, { type: 'interact' }, 'BOSS_ACTIVE');
  await until(() => f.fish(bossId).state === 'windup', 'boss never advertised its attack warning');
  assert.ok(f.fish(bossId).phaseRemaining > 0.8, 'boss warning was too short to react');
  assert.ok(['slam', 'lunge'].includes(f.fish(bossId).attackKind));
  assert.equal(f.fish(bossId).attackRadius, f.fish(bossId).attackKind === 'slam' ? 3.6 : f.fish(bossId).radius + 0.45);
  const mark = a.messages.length;
  await sleep(400);
  assert.equal(a.messages.slice(mark).some(event => event.type === 'combat' && event.kind === 'hurt' && event.actorId === bossId), false, 'boss dealt damage during warning');
  for (const client of users) client.send({ type: 'equip', weapon: 'pistol' });
  await sleep(110);
  for (let volley = 0; volley < 6 && f.fish(bossId).hp > 0; volley++) {
    for (const client of users) attackAt(f, client, f.fish(bossId));
    await sleep(270);
  }
  await until(() => f.fish(bossId).state === 'loot', 'cooperative volley did not defeat boss');
  assert.equal(f.server.snapshot().tasks.bossDefeated, 1);
  const value = f.fish(bossId).lootValue;
  assert.ok(value >= 100 && value <= 250);
  await moveTo(f, a, f.fish(bossId).x + 1, f.fish(bossId).z);
  a.send({ type: 'pickup', fishId: bossId }); await until(() => !f.fish(bossId), 'boss loot was not collected');
  await moveTo(f, a, 8, 0);
  await rejects(a, { type: 'interact' }, 'CHALLENGE_COOLDOWN');
  assert.equal((await f.save()).room.tasks.bossDefeated, 1);
});
