import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SurvivalWorld} from '../world.mjs';
import {loadConfig} from '../config.mjs';

// Pure memory ray/authority tests. No sockets, accounts, persistence or renderer.
// Only pellet spread is zeroed to isolate the exact two-stage ray convergence;
// real health, damage, muzzle height, collision radii and range remain unchanged.
const config = await loadConfig(new URL('../../../client/survival/balance.json', import.meta.url));
const worldSource = new URL('../world.mjs', import.meta.url);
const sourceHash = createHash('sha256').update(await readFile(worldSource)).digest('hex');
console.log(`DOWNED_RAY_SOURCE ${sourceHash}`);

function fixture({downed = true, friendly = true} = {}) {
  const cfg = structuredClone(config);
  for (const gun of cfg.weapons) { gun.hip_spread_deg = 0; gun.ads_spread_deg = 0; }
  const w = new SurvivalWorld(cfg, null, {onlineRoster: true});
  const shooter = w.allocate('合成射手', 'ray-fixture-shooter');
  const target = w.allocate('合成队员', 'ray-fixture-target');
  w.startNight();
  w.s.enemies = {}; w.s.projectiles = {}; w.s.destructibles = {};
  w.s.night.pending = []; w.s.night.bossDefeated = false;
  w.s.paused = false; w.s.friendlyFire = friendly;
  for (const [p, x] of [[shooter, 10], [target, 13]]) {
    Object.assign(p, {x, z: 10, y: w.ground(x, 10), vy: 0, joinProtectionUntil: 0});
    assert.equal(Boolean(w.blocked(p.x, p.y, p.z, cfg.player.capsule_radius)), false, 'fixture overlaps a world obstacle');
  }
  if (downed) {
    w.damageQueue.push({target: target.id, actorId: 'synthetic-ray-enemy', damage: target.hp});
    w.resolveDamage();
    assert.equal(target.lifeState, 'DOWNED', 'authority damage must create DOWNED');
    // Consume the real 1-second initial protection through ordinary world steps.
    for (let i = 0; i < 34; i++) {
      for (const p of [shooter, target]) w.input(p, {seq: p.inputAck + 1, dx: 0, dz: 0});
      w.step(1 / 30);
    }
    assert.equal(target.downedGraceRemaining, 0);
    assert.equal(target.hp, 0);
    assert.ok(target.downedHp > 0);
  }
  w.drainEvents();
  const dx = target.x - shooter.x, dz = target.z - shooter.z;
  const yaw = Math.atan2(-dx, -dz);
  const targetY = target.y + (downed ? .42 : 1.1);
  const pitch = Math.atan2(targetY - (shooter.y + cfg.player.camera_height), Math.hypot(dx, dz));
  const rays = [];
  const originalRayBlock = w.rayBlock.bind(w);
  // Read-only call tracing; the actual product collision query returns unchanged.
  w.rayBlock = (from, direction, maximum, ...rest) => {
    rays.push({from: {...from}, direction: {...direction}, maximum});
    return originalRayBlock(from, direction, maximum, ...rest);
  };
  return {w, shooter, target, yaw, pitch, rays};
}

function shoot(f) {
  f.w.fire(f.shooter, f.yaw, f.pitch, false);
  const shots = f.w.drainEvents().filter(event => event.eventType === 'Shot');
  assert.equal(shots.length, 1, 'carbine fixture emits one actual pellet');
  f.w.resolveDamage();
  return {shot: shots[0].payload, hits: f.w.drainEvents().filter(event => event.eventType === 'Hit')};
}

test('control: actual friendly fire hits an ALIVE teammate in this geometry', () => {
  const f = fixture({downed: false});
  const before = f.target.hp;
  const {shot} = shoot(f);
  assert.ok(shot.targetId === f.target.id, 'valid ALIVE target must be selected');
  assert.ok(f.target.hp < before, 'normal authority damage must reach the ALIVE teammate');
});

test('camera ray converges onto the low DOWNED sphere before computing the muzzle ray', () => {
  const f = fixture();
  shoot(f);
  assert.ok(f.rays.length >= 2, 'real fire must query camera and muzzle blockers');
  // Target is 3m away. A camera-stage hit converges before its center (<3.5m).
  // Ignoring its hp=0 instead converges at ground behind it (>3.5m).
  assert.ok(f.rays[1].maximum < 3.5, `DOWNED omitted from camera-stage aim; muzzle maximum=${f.rays[1].maximum.toFixed(6)}`);
});

test('muzzle ray selects the DOWNED teammate and resolveDamage removes downed blood', () => {
  const f = fixture();
  const before = f.target.downedHp;
  const {shot, hits} = shoot(f);
  assert.ok(shot.targetId === f.target.id, 'DOWNED omitted from final muzzle target selection');
  assert.ok(hits.some(event => event.payload.targetId === f.target.id && event.payload.downed === true), 'missing actual low-body Hit event');
  assert.ok(f.target.downedHp < before, 'a real bullet must remove downed blood');
});

test('friendly fire off still protects the DOWNED teammate from player bullets', () => {
  const f = fixture({friendly: false});
  const before = f.target.downedHp;
  const {shot, hits} = shoot(f);
  assert.ok(shot.targetId !== f.target.id, 'friendly fire off must exclude teammates');
  assert.equal(f.target.downedHp, before);
  assert.equal(hits.some(event => event.payload.targetId === f.target.id), false);
});

function turretLane({downed, teammateX}) {
  const f = fixture({downed, friendly: false});
  const {w, shooter, target} = f;
  // Installed turret and three lane positions are explicit spatial fixtures.
  // updateTurrets still uses the published 3.6m muzzle, range, radius and damage.
  Object.assign(shooter, {x: 10, z: 14, y: w.ground(10, 14)});
  Object.assign(target, {x: teammateX, z: 10, y: w.ground(teammateX, 10)});
  const turret = Object.values(w.s.turrets)[0];
  assert.ok(turret, 'normal world must contain a turret emplacement');
  Object.assign(turret, {x: 10, z: 10, y: w.ground(10, 10), level: 1, hp: w.c.fortress.levels[0].hp, ammo: 3, fireAt: 0, lockedBy: null});
  const enemy = w.spawnEnemy('crab', 18, 10, true);
  enemy.source = 'night';
  w.drainEvents();
  return {w, turret, target, enemy};
}

test('turret control: standing teammate blocks its real descending firing lane', () => {
  const {w, turret} = turretLane({downed: false, teammateX: 16});
  w.updateTurrets();
  assert.equal(turret.ammo, 3, 'standing friendly silhouette blocks the lane');
  assert.equal(w.drainEvents().some(event => event.eventType === 'Shot'), false);
});

test('turret fires over a DOWNED teammate when the same standing-height lane is now clear', () => {
  const {w, turret, target, enemy} = turretLane({downed: true, teammateX: 16});
  const blood = target.downedHp, enemyHp = enemy.hp;
  w.updateTurrets();
  const shots = w.drainEvents().filter(event => event.eventType === 'Shot');
  assert.equal(turret.ammo, 2, 'a low DOWNED silhouette must not keep blocking an overhead lane');
  assert.ok(shots.some(event => event.payload.targetId === enemy.id), 'turret must select the enemy behind the clear lane');
  w.resolveDamage();
  assert.ok(enemy.hp < enemyHp, 'real turret damage reaches the enemy');
  assert.equal(target.downedHp, blood, 'firing above a teammate cannot damage it');
});

test('turret still withholds fire when its lower lane intersects the actual DOWNED body', () => {
  const {w, turret} = turretLane({downed: true, teammateX: 17.2});
  w.updateTurrets();
  assert.equal(turret.ammo, 3, 'lower lane through the prone body must remain blocked');
  assert.equal(w.drainEvents().some(event => event.eventType === 'Shot'), false);
});
