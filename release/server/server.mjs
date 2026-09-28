import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, rename, writeFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.pck': 'application/octet-stream', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const FISH_TYPES = [
  { kind: '蓝鳍方鱼', value: 12, hp: 50, speed: 1.4, damage: 5, radius: 0.55, model: 'fish' },
  { kind: '赤尾方鱼', value: 20, hp: 75, speed: 1.7, damage: 7, radius: 0.6, model: 'fish' },
  { kind: '金冠方鱼', value: 35, hp: 110, speed: 1.3, damage: 9, radius: 0.7, model: 'goldfish' },
];
const WEAPONS = {
  rod: { name: '鱼竿', price: 0, damage: 22, range: 2.5, cooldown: 330 },
  fists: { name: '拳头', price: 0, damage: 22, range: 2.5, cooldown: 330 },
  knife: { name: '鱼刀', price: 36, damage: 32, range: 3, cooldown: 380 },
  pistol: { name: '手枪', price: 90, damage: 30, range: 30, cooldown: 240, ammo: 6, reload: 1.15 },
};
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const direction = (yaw, pitch = 0) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });
const xyz = value => ({ x: value.x, y: value.y ?? 0, z: value.z });
const distance3 = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
const number = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const safeName = name => (typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) : '') || '岛友';
const count = value => Number.isSafeInteger(value) && value >= 0;
function validSave(value) {
  if (!value || value.version !== 1 || !value.profiles || typeof value.profiles !== 'object' || Array.isArray(value.profiles) || typeof value.room?.friendlyFire !== 'boolean') return false;
  const tasks = value.room.tasks;
  if (!tasks || !['landed', 'sold', 'completed'].every(key => count(tasks[key])) || tasks.completed !== Math.floor(tasks.sold / 10)) return false;
  if (tasks.bossDefeated !== undefined && !count(tasks.bossDefeated)) return false;
  const ids = new Set();
  for (const [key, profile] of Object.entries(value.profiles)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !profile || typeof profile.id !== 'string' || ids.has(profile.id) || typeof profile.name !== 'string' || !count(profile.coins) || !Number.isInteger(profile.rod) || profile.rod < 1 || profile.rod > 5) return false;
    if (!Array.isArray(profile.bag) || profile.bag.length > 30 || !profile.bag.every(f => f && typeof f.kind === 'string' && count(f.value) && (f.styleLabels === undefined || (Array.isArray(f.styleLabels) && f.styleLabels.length <= 3 && f.styleLabels.every(label => typeof label === 'string' && label.length <= 32))))) return false;
    if (!profile.progress || !['caught', 'sold', 'earned'].every(key => count(profile.progress[key]))) return false;
    if (profile.weapons !== undefined && (!Array.isArray(profile.weapons) || profile.weapons.length > 3 || new Set(profile.weapons).size !== profile.weapons.length || !profile.weapons.every(weapon => ['fists', 'knife', 'pistol'].includes(weapon)))) return false;
    ids.add(profile.id);
  }
  return true;
}

export async function createGameServer(options = {}) {
  const port = options.port ?? Number(process.env.PORT || 8080);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const webRoot = path.resolve(options.webRoot ?? process.env.WEB_ROOT ?? path.join(ROOT, '..', 'web'));
  const saveFile = path.resolve(options.saveFile ?? process.env.SAVE_FILE ?? path.join(ROOT, 'data', 'save.json'));
  const shutdownToken = options.shutdownToken ?? process.env.SHUTDOWN_TOKEN ?? '';
  // Old rules remain available only to explicitly isolated regression fixtures.
  // No environment variable or network command can turn old modes on.
  const testLegacyModes = options.testLegacyModes === true;
  if (testLegacyModes && (!['127.0.0.1', '::1', 'localhost'].includes(host) || !options.saveFile)) {
    throw new Error('Legacy test modes require loopback and an explicit isolated saveFile');
  }
  const realWebRoot = await realpath(webRoot);
  const tickMs = options.tickMs ?? 100;
  const waitingMinMs = options.waitingMinMs ?? 3000;
  const waitingMaxMs = options.waitingMaxMs ?? 7000;
  const biteWindowMs = options.biteWindowMs ?? 4000;
  const random = options.random ?? Math.random;
  const world = { islandRadius: 14, spawn: { x: 0, z: 0 }, shop: { x: 0, z: -6 }, challenge: { x: 8, z: 0 }, ...(options.world ?? {}) };
  const maxPlayers = 4;
  let saved = { version: 1, room: { friendlyFire: false, tasks: { landed: 0, sold: 0, completed: 0 } }, profiles: {} };
  if (testLegacyModes) try {
    const parsed = JSON.parse(await readFile(saveFile, 'utf8'));
    if (!validSave(parsed)) throw new Error('Unsupported save format');
    saved = parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('存档读取失败，已停止启动以保护现有进度。请从备份恢复或检查存档格式。');
  }
  // Version 1 remains readable. Existing economy and basket entries are never repriced.
  saved.room.tasks.bossDefeated ??= 0;
  for (const profile of Object.values(saved.profiles)) {
    profile.weapons ??= ['fists'];
    if (!profile.weapons.includes('fists')) profile.weapons.unshift('fists');
  }
  const players = new Map();
  const fish = new Map();
  let hostId = null;
  let dirty = false;
  let saving = Promise.resolve();
  let closed = false;
  let stopping = null;
  let savedAt = 0;
  let lastTick = Date.now();
  let lastBossAt = -Infinity;

  function markDirty() { if (testLegacyModes) dirty = true; }
  function flushSave() {
    if (!testLegacyModes || !dirty) return saving;
    dirty = false;
    const data = JSON.stringify(saved, null, 2);
    saving = saving.catch(() => {}).then(async () => {
      await mkdir(path.dirname(saveFile), { recursive: true });
      const temporary = `${saveFile}.tmp`;
      await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, saveFile);
      savedAt = Date.now();
    }).catch(error => { dirty = true; throw error; });
    return saving;
  }
  function send(ws, message) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify(message));
  }
  function error(ws, code, message) { send(ws, { type: 'error', code, message }); }
  function notice(player, message) { send(player.ws, { type: 'notice', message }); }
  function landPosition(position) {
    const radius = Math.hypot(position.x, position.z);
    const limit = world.islandRadius - 0.5;
    if (radius > limit) { position.x *= limit / radius; position.z *= limit / radius; }
  }
  function publicPlayer(p, now) {
    return { id: p.id, name: p.profile.name, x: p.x, y: p.y, z: p.z, angle: p.angle, pitch: p.pitch, hp: p.hp,
      coins: p.profile.coins, rod: p.profile.rod, bag: p.profile.bag, progress: p.profile.progress, lastAttackAt: p.lastAttackAt,
      weapon: p.weapon, weapons: p.profile.weapons, ammo: p.ammo, heldFishId: p.heldFishId,
      reloadRemaining: Math.max(0, (p.reloadAt - now) / 1000), charge: p.chargeStartedAt === null ? 0 : clamp((now - p.chargeStartedAt) / 1000, 0, 1),
      cast: p.cast ? { phase: p.cast.phase, x: p.cast.x, z: p.cast.z, progress: p.cast.progress, remaining: Math.max(0, (p.cast.at - now) / 1000) } : null };
  }
  function state() {
    const now = Date.now();
    return { type: 'state', protocolVersion: 2, build: '0.2.0', time: now, savedAt, hostId, friendlyFire: saved.room.friendlyFire, maxPlayers, world,
      players: [...players.values()].map(p => publicPlayer(p, now)),
      fish: [...fish.values()].map(f => ({ id: f.id, kind: f.kind, x: f.x, y: f.y, z: f.z, angle: f.angle, hp: f.hp, maxHp: f.maxHp,
        state: f.state, phaseRemaining: Math.max(0, (f.phaseAt - now) / 1000), hitAt: f.hitAt, boss: f.boss,
        lootValue: f.lootValue, styleLabels: f.styleLabels, model: f.model, radius: f.radius, attackRadius: f.slam ? 3.6 : f.radius + 0.45,
        attackKind: f.slam ? 'slam' : 'lunge', ownerId: f.ownerId, heldById: f.heldById })),
      tasks: { ...saved.room.tasks, target: (saved.room.tasks.completed + 1) * 10 },
      upgrades: { nextCostBase: 40, maxRod: 5 },
      weaponCatalog: WEAPONS,
    };
  }
  function broadcast() { const message = state(); for (const p of players.values()) send(p.ws, message); }
  function combat(message) { for (const p of players.values()) send(p.ws, { type: 'combat', ...message }); }
  function releaseHeld(player, now) {
    const held = fish.get(player.heldFishId);
    if (held) { held.heldById = null; held.state = held.hp > 0 ? 'airborne' : 'loot'; held.vx = 0; held.vz = 0; held.vy = 0; held.phaseAt = now; }
    player.heldFishId = null;
  }
  function hitPlayer(player, damage, now, actorId = null, weapon = null) {
    if (now < player.invulnerableUntil) return;
    player.hp = Math.max(0, player.hp - damage);
    combat({ kind: 'hurt', actorId, targetId: player.id, ...xyz(player), damage, weapon });
    if (player.hp === 0) {
      releaseHeld(player, now);
      player.hp = 100; player.x = world.spawn.x; player.z = world.spawn.z; player.y = 0; player.vy = 0;
      player.input = { dx: 0, dz: 0, at: now }; player.cast = null; player.invulnerableUntil = now + 4000;
      player.chargeStartedAt = null; player.releasedChargeMs = 0;
      notice(player, '你被撞回了营地，金币、背包与装备均已保留。');
    }
  }
  function spawnFish(player, now, boss = false) {
    const type = boss ? { kind: '礁甲巨蟹', value: 100, hp: Math.round(260 * Math.min(2, 1 + (players.size - 1) / 3)), speed: 1.55, damage: 16, radius: 1.25, model: 'crab' }
      : FISH_TYPES[Math.floor(random() * FISH_TYPES.length) % FISH_TYPES.length];
    const forward = direction(player.angle);
    const f = { ...type, id: randomUUID(), x: boss ? world.challenge.x - 2 : player.x + forward.x * 1.8,
      z: boss ? world.challenge.z : player.z + forward.z * 1.8, y: boss ? 0.12 : 0.8,
      vx: boss ? 0 : forward.x * 2.0, vy: boss ? 0 : 3.4, vz: boss ? 0 : forward.z * 2.0,
      maxHp: type.hp, ownerId: player.id, createdAt: now, lastHitAt: 0, hitAt: 0, angle: player.angle,
      boss, state: boss ? 'recover' : 'airborne', phaseAt: now + (boss ? 900 : 0), heldById: null,
      lootValue: 0, styleLabels: [], playerLaunched: false, contributors: new Set(), hits: new Set(), streaks: new Map() };
    landPosition(f); fish.set(f.id, f);
    if (!boss) { saved.room.tasks.landed += 1; markDirty(); }
    return f;
  }
  function aim(message, ws) {
    if (!number(message.aimYaw) || !number(message.aimPitch) || message.aimPitch < -1.55 || message.aimPitch > 1.55) {
      error(ws, 'INVALID_AIM', '请朝准星方向攻击。'); return null;
    }
    return direction(message.aimYaw, message.aimPitch);
  }
  function selectHit(player, forward, weapon) {
    const origin = { x: player.x, y: player.y + 1.62, z: player.z };
    const candidates = [...fish.values()].filter(f => f.hp > 0).map(f => ({ body: f, isPlayer: false, radius: f.radius,
      center: { x: f.x, y: f.y + (f.boss ? 0.9 : 0.4), z: f.z } }));
    if (saved.room.friendlyFire) for (const other of players.values()) if (other !== player) candidates.push({ body: other, isPlayer: true, radius: 0.65,
      center: { x: other.x, y: other.y + 1, z: other.z } });
    const hits = [];
    for (const candidate of candidates) {
      const v = { x: candidate.center.x - origin.x, y: candidate.center.y - origin.y, z: candidate.center.z - origin.z };
      const projected = v.x * forward.x + v.y * forward.y + v.z * forward.z;
      const length = Math.hypot(v.x, v.y, v.z);
      if (projected <= 0 || length - candidate.radius > weapon.range) continue;
      if (weapon === WEAPONS.pistol) {
        const perpendicular2 = Math.max(0, length * length - projected * projected);
        if (perpendicular2 > candidate.radius * candidate.radius) continue;
        const entry = projected - Math.sqrt(candidate.radius * candidate.radius - perpendicular2);
        if (entry > weapon.range) continue;
        hits.push({ ...candidate, entry: Math.max(0, entry) });
      } else {
        // Broad melee cone allows low fish, but no target behind the attack direction.
        if (projected / Math.max(length, 0.001) < 0.25) continue;
        hits.push({ ...candidate, entry: Math.max(0, length - candidate.radius) });
      }
    }
    return hits.sort((a, b) => a.entry - b.entry)[0] ?? null;
  }
  function killFish(f, player, weapon, now, eligibleAirKill) {
    if (f.state === 'loot' || f.lootValue > 0) return;
    const labels = [];
    let multiplier = 1;
    if (eligibleAirKill) { labels.push('空中终结'); multiplier += 0.5; }
    if (f.contributors.size >= 2) { labels.push('多人助攻'); multiplier += 0.25; }
    if ((f.streaks.get(player.id) ?? 0) >= 3) { labels.push('连续命中'); multiplier += 0.25; }
    f.hp = 0; f.state = 'loot'; f.lootValue = Math.round(f.value * Math.min(multiplier, 2.5)); f.styleLabels = labels;
    f.phaseAt = now; f.expiresAt = now + 120000;
    if (f.boss) { saved.room.tasks.bossDefeated += 1; markDirty(); }
    combat({ kind: 'kill', actorId: player.id, targetId: f.id, ...xyz(f), weapon, styleLabels: labels, value: f.lootValue });
    notice(player, '鱼倒下了！靠近按 E 收入鱼篓，也可以抓起抛空。');
  }
  function startReeling(player, automatic, now) {
    player.cast.phase = 'reeling'; player.cast.progress = 0; player.cast.at = now + 12000;
    player.cast.automatic = automatic; player.cast.held = true; player.cast.heldAt = now;
  }
  function attack(player, message, now) {
    const forward = aim(message, player.ws); if (!forward) return;
    if (message.heavy !== undefined && typeof message.heavy !== 'boolean') return error(player.ws, 'INVALID_ATTACK', '攻击参数不正确。');
    if (message.aiming !== undefined && typeof message.aiming !== 'boolean') return error(player.ws, 'INVALID_ATTACK', '攻击参数不正确。');
    if (now < player.nextAttackAt) return;
    const key = player.weapon === 'rod' ? 'fists' : player.weapon;
    const weapon = WEAPONS[key];
    if (key === 'pistol' && player.reloadAt > now) return error(player.ws, 'RELOADING', '正在换弹。');
    if (key === 'pistol' && player.ammo <= 0) return error(player.ws, 'EMPTY_MAGAZINE', '弹匣空了，按 R 换弹。');
    const chargeMs = player.chargeStartedAt === null ? (now - player.releasedChargeAt <= 500 ? player.releasedChargeMs : 0) : now - player.chargeStartedAt;
    const heavy = key === 'fists' && message.heavy === true && chargeMs >= 250;
    const damage = heavy ? Math.round(26 + 14 * clamp((chargeMs - 250) / 750, 0, 1)) : weapon.damage;
    player.nextAttackAt = now + (heavy ? 550 : weapon.cooldown); player.lastAttackAt = now;
    player.chargeStartedAt = null; player.releasedChargeMs = 0;
    player.angle = message.aimYaw; player.pitch = message.aimPitch;
    if (key === 'pistol') player.ammo -= 1;
    const origin = { x: player.x, y: player.y + 1.62, z: player.z };
    const hit = selectHit(player, forward, weapon);
    const end = hit ? { ...hit.center } : { x: origin.x + forward.x * weapon.range, y: origin.y + forward.y * weapon.range, z: origin.z + forward.z * weapon.range };
    combat({ kind: 'swing', actorId: player.id, ...origin, weapon: key, heavy, from: origin, to: end });
    if (!hit) {
      player.comboTarget = null; player.comboCount = 0;
      for (const f of fish.values()) f.streaks.delete(player.id);
      return;
    }
    if (hit.isPlayer) { player.comboTarget = null; player.comboCount = 0; hitPlayer(hit.body, damage, now, player.id, key); return; }
    const target = hit.body;
    const eligibleAirKill = target.y > 0.45 && target.playerLaunched;
    // Suspended live fish remain valid targets. A hit releases both sides of the
    // holding relationship before knockback, so held physics cannot overwrite it.
    if (target.heldById) {
      const holder = players.get(target.heldById);
      if (holder?.heldFishId === target.id) holder.heldFishId = null;
      target.heldById = null;
    }
    player.comboCount = player.comboTarget === target.id && now - player.comboAt <= 2200 ? player.comboCount + 1 : 1;
    player.comboTarget = target.id; player.comboAt = now;
    target.streaks.set(player.id, player.comboCount); target.contributors.add(player.id);
    target.hp = Math.max(0, target.hp - damage); target.hitAt = now;
    target.vx += forward.x * (heavy ? 4.7 : key === 'pistol' ? 0.8 : 1.6);
    target.vz += forward.z * (heavy ? 4.7 : key === 'pistol' ? 0.8 : 1.6);
    if (heavy) { target.vy = Math.max(target.vy, 6.3); target.playerLaunched = true; target.state = 'airborne'; }
    else { target.state = 'stunned'; target.phaseAt = now + (target.boss ? 160 : 280); }
    combat({ kind: 'hit', actorId: player.id, targetId: target.id, ...hit.center, weapon: key, damage, heavy });
    if (target.hp <= 0) killFish(target, player, key, now, eligibleAirKill);
  }
  function action(player, message, now) {
    const ws = player.ws;
    if (message.type === 'input') {
      if (!number(message.dx) || !number(message.dz) || !number(message.angle) || (message.pitch !== undefined && !number(message.pitch)) || (message.sprint !== undefined && typeof message.sprint !== 'boolean') || (message.reeling !== undefined && typeof message.reeling !== 'boolean')) return error(ws, 'INVALID_INPUT', '移动参数不正确。');
      let dx = clamp(message.dx, -1, 1), dz = clamp(message.dz, -1, 1);
      const length = Math.hypot(dx, dz); if (length > 1) { dx /= length; dz /= length; }
      player.input = { dx, dz, at: now, sprint: message.sprint === true }; player.angle = ((message.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      player.pitch = clamp(message.pitch ?? 0, -1.55, 1.55);
      if (player.cast?.phase === 'reeling' && !player.cast.automatic) { player.cast.held = message.reeling === true; player.cast.heldAt = now; }
      return;
    }
    if (message.type === 'jump') { if (player.y <= 0 && player.vy <= 0) player.vy = 4.7; return; }
    if (message.type === 'equip') {
      if (typeof message.weapon !== 'string' || !own(WEAPONS, message.weapon) || (message.weapon !== 'rod' && !player.profile.weapons.includes(message.weapon))) return error(ws, 'WEAPON_NOT_OWNED', '还没有这件武器，请到商店购买。');
      player.weapon = message.weapon; player.chargeStartedAt = null; player.releasedChargeMs = 0; return;
    }
    if (message.type === 'charge') {
      if (typeof message.active !== 'boolean') return error(ws, 'INVALID_CHARGE', '蓄力参数不正确。');
      if (message.active && player.chargeStartedAt === null) { player.chargeStartedAt = now; player.releasedChargeMs = 0; }
      else if (!message.active && player.chargeStartedAt !== null) { player.releasedChargeMs = Math.min(1000, now - player.chargeStartedAt); player.releasedChargeAt = now; player.chargeStartedAt = null; }
      return;
    }
    if (message.type === 'reload') {
      if (!player.profile.weapons.includes('pistol')) return error(ws, 'WEAPON_NOT_OWNED', '还没有手枪。');
      if (player.ammo < 6 && player.reloadAt <= now) { player.reloadAt = now + 1150; combat({ kind: 'reload', actorId: player.id, ...xyz(player), weapon: 'pistol' }); }
      return;
    }
    if (message.type === 'grab') {
      const target = fish.get(message.fishId);
      if (!target || distance3(player, target) > 3) return error(ws, 'GRAB_TOO_FAR', '靠近三米内的鱼才能抓起。');
      if (player.heldFishId || target.heldById) return error(ws, 'FISH_HELD', '这条鱼已经被抓住，或你手上已经有鱼。');
      if (!['stunned', 'recover', 'loot'].includes(target.state) && !(target.state === 'airborne' && !target.playerLaunched && now - target.createdAt < 2500)) return error(ws, 'FISH_RESISTING', '等鱼硬直、倒地或刚上岸时再抓起。');
      target.heldById = player.id; target.state = 'held'; target.vx = 0; target.vy = 0; target.vz = 0; player.heldFishId = target.id;
      combat({ kind: 'grab', actorId: player.id, targetId: target.id, ...xyz(target) }); return;
    }
    if (message.type === 'throw') {
      const forward = aim(message, ws); if (!forward) return;
      const target = fish.get(player.heldFishId);
      if (!target || target.heldById !== player.id) return error(ws, 'NO_HELD_FISH', '手里还没有鱼。');
      const from = xyz(target);
      target.heldById = null; player.heldFishId = null; target.state = target.hp > 0 ? 'airborne' : 'loot';
      target.vx = forward.x * 11; target.vz = forward.z * 11; target.vy = Math.max(4.5, forward.y * 11); target.playerLaunched = true;
      combat({ kind: 'throw', actorId: player.id, targetId: target.id, ...from, from, to: { x: from.x + forward.x * 8, y: from.y + forward.y * 8, z: from.z + forward.z * 8 } }); return;
    }
    if (message.type === 'pickup') {
      const target = fish.get(message.fishId);
      if (!target || target.hp > 0 || !target.lootValue) return error(ws, 'NOT_LOOT', '这条鱼还不能收入鱼篓。');
      if (distance3(player, target) > 3) return error(ws, 'PICKUP_TOO_FAR', '靠近三米内的渔获再拾取。');
      if (target.heldById && target.heldById !== player.id) return error(ws, 'FISH_HELD', '队友正抓着这条鱼。');
      if (player.profile.bag.length >= 30) return error(ws, 'BAG_FULL', '鱼篓已满，请先卖鱼；渔获还留在地上。');
      fish.delete(target.id); if (player.heldFishId === target.id) player.heldFishId = null;
      player.profile.bag.push({ kind: target.kind, value: target.lootValue, styleLabels: [...target.styleLabels] });
      player.profile.progress.caught += 1; markDirty();
      combat({ kind: 'pickup', actorId: player.id, targetId: target.id, ...xyz(target), value: target.lootValue, styleLabels: target.styleLabels });
      notice(player, `收入鱼篓：${target.kind}（${target.lootValue} 金币）`); return;
    }
    if (message.type === 'interact') {
      if (distance(player, world.challenge) > 3) return error(ws, 'CHALLENGE_TOO_FAR', '靠近巨蟹挑战标记再发起挑战。');
      if (saved.room.tasks.landed < 3) return error(ws, 'CHALLENGE_LOCKED', '全岛先钓上三条鱼，再挑战礁甲巨蟹。');
      if ([...fish.values()].some(f => f.boss)) return error(ws, 'BOSS_ACTIVE', '先结束当前巨蟹挑战并收好渔获。');
      if (now - lastBossAt < 30000) return error(ws, 'CHALLENGE_COOLDOWN', '巨蟹挑战尚在冷却，请稍候。');
      lastBossAt = now; spawnFish(player, now, true); notice(player, '礁甲巨蟹来了！观察预警，躲开扑击后反击。'); return;
    }
    if (message.type === 'settings') {
      if (hostId !== player.id) return error(ws, 'HOST_ONLY', '只有房主可以修改队友伤害。');
      if (typeof message.friendlyFire !== 'boolean') return error(ws, 'INVALID_SETTINGS', '设置参数不正确。');
      saved.room.friendlyFire = message.friendlyFire; markDirty(); broadcast(); return;
    }
    if (message.type === 'cast') {
      if (player.cast) return error(ws, 'ALREADY_CASTING', '你已经抛竿了，等鱼咬钩后再收线。');
      if (player.profile.bag.length >= 30) return error(ws, 'BAG_FULL', '鱼篓已满，请先去商店卖鱼。');
      if ([...fish.values()].filter(f => f.ownerId === player.id && f.hp > 0 && !f.boss).length >= 3 || fish.size >= 32) return error(ws, 'FISH_LIMIT', '先制服或收好已经上岸的鱼，再抛竿。');
      if (!number(message.x) || !number(message.z)) return error(ws, 'INVALID_CAST', '请朝水面抛竿。');
      const power = message.power ?? 1;
      if (!number(power) || power < 0 || power > 1) return error(ws, 'INVALID_CAST', '抛竿力度不正确。');
      const target = { x: message.x, z: message.z };
      if (Math.hypot(target.x, target.z) < world.islandRadius + 0.3) return error(ws, 'NOT_WATER', '请将鱼钩投到岛外的水面。');
      if (distance(player, target) > (8 + player.profile.rod * 2) * (0.35 + 0.65 * power)) return error(ws, 'CAST_TOO_FAR', '距离太远，请走到岸边再抛竿。');
      if (now - player.lastCastAt < 1000) return error(ws, 'COOLDOWN', '稍等片刻再抛竿。');
      player.lastCastAt = now;
      player.cast = { ...target, phase: 'waiting', progress: 0, at: now + waitingMinMs + random() * (waitingMaxMs - waitingMinMs) };
      return;
    }
    if (message.type === 'cancel_cast') { player.cast = null; return; }
    if (message.type === 'reel') {
      if (message.held !== undefined && typeof message.held !== 'boolean') return error(ws, 'INVALID_REEL', '收线参数不正确。');
      if (!player.cast) { if (message.held === false) return; return error(ws, 'NO_CAST', '请先朝水面抛竿。'); }
      if (player.cast.phase === 'reeling') {
        if (message.held === undefined) player.cast.automatic = true;
        else { player.cast.held = message.held; player.cast.heldAt = now; }
        return;
      }
      if (message.held === false) return;
      if (player.cast.phase !== 'bite' || now > player.cast.at) { player.cast = null; return notice(player, '这次没钓到鱼，等咬钩提示再收线。'); }
      startReeling(player, message.held === undefined, now); return;
    }
    if (message.type === 'attack') return attack(player, message, now);
    if (message.type === 'buy_weapon') {
      if (distance(player, world.shop) > 3) return error(ws, 'SHOP_TOO_FAR', '请靠近营地商店。');
      if (!['knife', 'pistol'].includes(message.weapon)) return error(ws, 'INVALID_WEAPON', '商店没有这件武器。');
      if (player.profile.weapons.includes(message.weapon)) return error(ws, 'ALREADY_OWNED', '已经拥有这件武器。');
      const cost = WEAPONS[message.weapon].price;
      if (player.profile.coins < cost) return error(ws, 'NOT_ENOUGH_COINS', `购买需要 ${cost} 金币。`);
      player.profile.coins -= cost; player.profile.weapons.push(message.weapon); markDirty(); notice(player, `已购买${WEAPONS[message.weapon].name}。`); return;
    }
    if (message.type === 'sell' || message.type === 'upgrade') {
      if (distance(player, world.shop) > 3) return error(ws, 'SHOP_TOO_FAR', '请靠近营地商店。');
      if (message.type === 'sell') {
        if (!player.profile.bag.length) return error(ws, 'EMPTY_BAG', '鱼篓里还没有鱼。');
        const count = player.profile.bag.length;
        const total = player.profile.bag.reduce((sum, f) => sum + f.value, 0);
        player.profile.bag = []; player.profile.coins += total; player.profile.progress.sold += count; player.profile.progress.earned += total;
        saved.room.tasks.sold += count; saved.room.tasks.completed = Math.floor(saved.room.tasks.sold / 10);
        markDirty(); notice(player, `卖出 ${count} 条鱼，获得 ${total} 金币。`); return;
      }
      if (player.profile.rod >= 5) return error(ws, 'MAX_UPGRADE', '鱼竿已升至最高等级。');
      const cost = player.profile.rod * 40;
      if (player.profile.coins < cost) return error(ws, 'NOT_ENOUGH_COINS', `升级需要 ${cost} 金币。`);
      player.profile.coins -= cost; player.profile.rod += 1; markDirty(); notice(player, `鱼竿已升至 ${player.profile.rod} 级，抛竿更远，收线更快。`); return;
    }
    error(ws, 'UNKNOWN_ACTION', '无法识别的操作。');
  }

  function segmentDistance(point, from, to) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const length2 = dx * dx + dz * dz;
    const t = length2 ? clamp(((point.x - from.x) * dx + (point.z - from.z) * dz) / length2, 0, 1) : 0;
    return Math.hypot(point.x - from.x - dx * t, point.z - from.z - dz * t);
  }
  function updateFish(f, now, dt) {
    if (f.heldById) {
      const holder = players.get(f.heldById);
      if (holder) {
        const forward = direction(holder.angle, holder.pitch);
        f.x = holder.x + forward.x * 1.7; f.z = holder.z + forward.z * 1.7;
        f.y = Math.max(0.12, holder.y + 1.05 + forward.y * 0.75); f.angle = holder.angle; return;
      }
      f.heldById = null; f.state = f.hp > 0 ? 'airborne' : 'loot';
    }
    const expiry = f.hp <= 0 ? f.expiresAt : f.createdAt + (f.boss ? 300000 : 90000);
    if (now >= expiry) { fish.delete(f.id); combat({ kind: 'escape', actorId: f.ownerId, targetId: f.id, ...xyz(f) }); return; }
    f.x += f.vx * dt; f.z += f.vz * dt;
    const drag = Math.exp(-2.4 * dt); f.vx *= drag; f.vz *= drag;
    if (f.y > 0.12 || f.vy > 0) { f.vy -= 11 * dt; f.y += f.vy * dt; }
    if (f.y <= 0.12) { f.y = 0.12; f.vy = 0; }
    landPosition(f);
    if (f.hp <= 0) return;
    if (f.state === 'airborne') {
      if (f.y <= 0.12) { f.state = 'recover'; f.phaseAt = now + (f.boss ? 600 : 350); }
      return;
    }
    if (f.state === 'stunned' || f.state === 'recover') {
      if (now < f.phaseAt) return;
      f.state = f.y > 0.12 ? 'airborne' : 'chase';
    }
    if (f.state === 'airborne') return;
    const target = [...players.values()].sort((a, b) => distance(a, f) - distance(b, f))[0];
    if (!target) return;
    if (f.state === 'chase') {
      const d = distance(target, f);
      if (d < (f.boss ? 5.2 : 3.0)) {
        f.state = 'windup'; f.phaseAt = now + (f.boss ? 1100 : 550);
        const length = Math.max(d, 0.001);
        f.attackDX = (target.x - f.x) / length; f.attackDZ = (target.z - f.z) / length;
        f.angle = Math.atan2(-f.attackDX, -f.attackDZ);
        f.slam = f.boss && d < 2.6; f.hits.clear();
      } else if (d < 24) {
        f.x += (target.x - f.x) / d * f.speed * dt; f.z += (target.z - f.z) / d * f.speed * dt;
        f.angle = Math.atan2(f.x - target.x, f.z - target.z); landPosition(f);
      }
      return;
    }
    if (f.state === 'windup') {
      if (now >= f.phaseAt) { f.state = 'lunge'; f.phaseAt = now + (f.slam ? 180 : f.boss ? 700 : 420); }
      return;
    }
    if (f.state === 'lunge') {
      if (now >= f.phaseAt) { f.state = 'recover'; f.phaseAt = now + (f.boss ? 1250 : 800); return; }
      const from = { x: f.x, z: f.z };
      if (!f.slam) { const speed = f.boss ? 7.0 : 5.5; f.x += f.attackDX * speed * dt; f.z += f.attackDZ * speed * dt; landPosition(f); }
      for (const p of players.values()) {
        const intersects = f.slam ? distance(p, f) <= 3.6 : segmentDistance(p, from, f) <= f.radius + 0.45;
        if (intersects && p.y < (f.slam ? 0.75 : 0.95) && !f.hits.has(p.id)) { f.hits.add(p.id); hitPlayer(p, f.damage, now, f.id); }
      }
    }
  }

  // Latest release hosts accounts, signaling and saves; room owners simulate.
  // Legacy worlds are never loaded by the launcher and remain offline backups.
  const survival = testLegacyModes && options.survival ? await (await import('./survival/service.mjs')).createSurvivalService({
    saveDir: options.survivalSaveDir ?? path.join(path.dirname(saveFile), 'survival'),
    configPath: options.survivalConfigPath ?? path.join(ROOT, '..', 'client', 'survival', 'balance.json'),
    savePolicy: 'continuous',
  }) : null;
  const platform = (options.platform ?? !testLegacyModes) ? await (await import('./platform/service.mjs')).createPlatformService({dataDir:options.platformDataDir??path.join(path.dirname(saveFile),'platform')}) : null;
  const httpServer = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if(request.socket.encrypted||/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?$/i.test(request.headers.host??''))response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cache-Control', 'no-cache');
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400); response.end(); return; }
    const route = pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (!testLegacyModes) {
      if (['/legacy.html', '/classic.html', '/legacy', '/classic'].includes(route)) {
        response.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); response.end(); return;
      }
      if (route === '/ws' || route.startsWith('/survival/') || route === '/survival' || route.startsWith('/classic/') || route.startsWith('/legacy/') || (route.startsWith('/api/') && !route.startsWith('/api/platform/'))) {
        response.writeHead(410, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: { code: 'LEGACY_RETIRED', message: '旧版入口已停用，请回到最新大厅。', location: '/' } })); return;
      }
    }
    if(platform&&!closed&&await platform.handleRequest(request,response))return;
    if (pathname === '/shutdown' && request.method === 'POST') {
      const remote = request.socket.remoteAddress;
      const supplied = request.headers['x-shutdown-token'];
      const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
      const tokenOK = typeof supplied === 'string' && shutdownToken.length >= 32 && Buffer.byteLength(supplied) === Buffer.byteLength(shutdownToken) && timingSafeEqual(Buffer.from(supplied), Buffer.from(shutdownToken));
      if (!allowed || request.headers.origin || !tokenOK) { response.writeHead(403); response.end(); return; }
      closed = true;
      try { if (survival) await survival.stop(); if (platform) await platform.stop(); markDirty(); await flushSave(); } catch { closed = false; response.writeHead(500); response.end('Save failed'); return; }
      response.writeHead(200, { 'Content-Type': MIME['.json'], Connection: 'close' });
      response.end(JSON.stringify({ ok: true, pid: process.pid, saved: true }));
      setImmediate(() => stop().catch(() => { console.error('存档写入失败，请检查服务器目录。'); process.exitCode = 1; }));
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    if (pathname === '/health') {
      const platformStatus = platform?.status() ?? null;
      const survivalStatus = survival?.status() ?? null;
      const ready = !closed && (!survivalStatus || survivalStatus.ready) && (!platformStatus || platformStatus.ready);
      response.setHeader('Content-Type', MIME['.json']);
      response.end(JSON.stringify({ ok: ready, service: 'voxel-fishing', build: '0.11.8', pid: process.pid, ready, players: players.size + (survivalStatus?.players ?? 0), classicPlayers: players.size, maxPlayers: testLegacyModes ? maxPlayers : 8, mode: testLegacyModes ? 'isolated-legacy-test' : 'latest-only', legacyEnabled: testLegacyModes, survival: survivalStatus, platform: platformStatus }));
      return;
    }
    if (closed) { response.writeHead(503); response.end(); return; }
    if (pathname.includes('\0') || pathname.includes('\\')) { response.writeHead(400); response.end(); return; }
    const target = path.resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(webRoot + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      const resolved = await realpath(target);
      if (!resolved.startsWith(realWebRoot + path.sep)) { response.writeHead(403); response.end(); return; }
      const info = await stat(target);
      if (!info.isFile()) throw new Error('not a file');
      response.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': info.size });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(target); stream.on('error', () => response.destroy()); stream.pipe(response);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('网页文件尚未导出。请将 Godot Web 导出文件放入 web 目录。'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  httpServer.on('upgrade', (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if(platform&&!closed&&pathname==='/platform/signal'){platform.handleUpgrade(request,socket,head);return;}
    if (!testLegacyModes) { socket.end('HTTP/1.1 410 Gone\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    if (closed || (pathname !== '/ws' && pathname !== '/survival/ws') || wss.clients.size >= 12) { socket.destroy(); return; }
    // Block cross-site browser requests; direct native clients have no Origin header.
    if (request.headers.origin) {
      try { if (new URL(request.headers.origin).host !== request.headers.host) { socket.destroy(); return; } } catch { socket.destroy(); return; }
    }
    if (pathname === '/survival/ws') {
      if (survival) survival.handleUpgrade(request, socket, head);
      else socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let player = null;
    let windowStart = Date.now(), messageCount = 0;
    const helloTimeout = setTimeout(() => { if (!player) ws.close(1008, 'hello required'); }, 10000);
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('message', (raw, binary) => {
      if (closed) return;
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; messageCount = 0; }
      if (++messageCount > 45) { ws.close(1008, 'rate limited'); return; }
      if (binary) return error(ws, 'TEXT_REQUIRED', '仅支持 JSON 文本消息。');
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return error(ws, 'INVALID_JSON', '消息格式不正确。'); }
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') return error(ws, 'INVALID_MESSAGE', '消息格式不正确。');
      if (!player) {
        if (message.type !== 'hello') return error(ws, 'HELLO_REQUIRED', '请先加入房间。');
        let token = typeof message.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(message.token) ? message.token : null;
        let key = token ? hashToken(token) : null;
        let profile = key ? saved.profiles[key] : null;
        if (message.token && !profile) { error(ws, 'UNKNOWN_PROFILE', '未找到这个渔友的存档。原有身份已保留，请检查服务器存档，或使用新昵称创建角色。'); ws.close(4003, 'unknown profile'); return; }
        const existing = profile ? [...players.values()].find(p => p.profile.id === profile.id) : null;
        if (players.size >= maxPlayers && !existing) { error(ws, 'ROOM_FULL', '房间已满，最多支持 4 人。'); ws.close(1008, 'room full'); return; }
        if (!profile) {
          token = randomBytes(32).toString('base64url'); key = hashToken(token);
          profile = { id: randomUUID(), name: safeName(message.name), coins: 0, rod: 1, bag: [], weapons: ['fists'], progress: { caught: 0, sold: 0, earned: 0 } };
          saved.profiles[key] = profile;
        }
        profile.name = safeName(message.name ?? profile.name); markDirty();
        if (existing) {
          player = existing; const oldSocket = existing.ws; existing.ws = ws;
          oldSocket.close(4001, 'session replaced');
        } else {
          const offsets = [[0, 0], [1.8, 0], [-1.8, 0], [0, 1.8]];
          const offset = offsets.find(([dx, dz]) => [...players.values()].every(p => distance(p, { x: world.spawn.x + dx, z: world.spawn.z + dz }) > 1)) ?? offsets[players.size % offsets.length];
          player = { id: profile.id, profile, ws, x: world.spawn.x + offset[0], y: 0, vy: 0, z: world.spawn.z + offset[1], angle: 0, pitch: 0, hp: 100,
            weapon: 'rod', ammo: 6, reloadAt: 0, heldFishId: null, chargeStartedAt: null, releasedChargeMs: 0, releasedChargeAt: 0,
            nextAttackAt: 0, comboTarget: null, comboCount: 0, comboAt: 0,
            input: { dx: 0, dz: 0, at: now }, cast: null, lastAttackAt: 0, lastCastAt: 0, invulnerableUntil: now + 3000 };
          players.set(player.id, player);
        }
        if (!hostId) hostId = player.id;
        clearTimeout(helloTimeout);
        send(ws, { type: 'welcome', token, playerId: player.id }); broadcast(); return;
      }
      if (player.ws !== ws) return;
      action(player, message, now);
    });
    ws.on('close', () => {
      clearTimeout(helloTimeout);
      if (!player || player.ws !== ws) return;
      releaseHeld(player, Date.now());
      players.delete(player.id);
      if (hostId === player.id) hostId = players.keys().next().value ?? null;
      markDirty(); broadcast();
    });
  });

  const tick = testLegacyModes ? setInterval(() => {
    if (closed) return;
    const now = Date.now(), dt = Math.min((now - lastTick) / 1000, 0.25); lastTick = now;
    for (const player of players.values()) {
      if (now - player.input.at < 500) {
        const speed = player.input.sprint ? 6.8 : 4.5;
        player.x += player.input.dx * speed * dt; player.z += player.input.dz * speed * dt; landPosition(player);
      }
      if (player.y > 0 || player.vy > 0) { player.y += player.vy * dt - 5.5 * dt * dt; player.vy -= 11 * dt; }
      if (player.y <= 0) { player.y = 0; player.vy = 0; }
      if (player.reloadAt > 0 && now >= player.reloadAt) { player.reloadAt = 0; player.ammo = 6; combat({ kind: 'reload', actorId: player.id, ...xyz(player), weapon: 'pistol', value: 6 }); }
      if (player.cast && now >= player.cast.at) {
        if (player.cast.phase === 'waiting') { player.cast.phase = 'bite'; player.cast.at = now + biteWindowMs; notice(player, '咬钩了！现在收线！'); }
        else { player.cast = null; notice(player, '鱼溜走了，再试一次。'); }
      }
      if (player.cast?.phase === 'reeling' && (player.cast.automatic || (player.cast.held && now - player.cast.heldAt < 500))) {
        player.cast.progress = Math.min(1, player.cast.progress + dt / (1.35 / (1 + 0.05 * (player.profile.rod - 1))));
        if (player.cast.progress >= 1) { spawnFish(player, now); player.cast = null; notice(player, '鱼甩到面前了！瞄准攻击，硬直时还可以抓起抛空。'); }
      }
      if (player.cast && distance(player, player.cast) > 11 + player.profile.rod * 2) { player.cast = null; notice(player, '走得太远，鱼线收回了。'); }
    }
    // Small bounded substeps keep throws and lunges stable at the 10 Hz broadcast rate.
    for (let remaining = dt; remaining > 0; remaining -= 0.025) {
      const step = Math.min(remaining, 0.025);
      for (const f of [...fish.values()]) updateFish(f, now, step);
    }
    broadcast();
  }, tickMs) : null;
  const saveTimer = testLegacyModes ? setInterval(() => { flushSave().catch(() => { for (const player of players.values()) notice(player, '进度暂未写入磁盘，请检查服务器存储空间。'); }); }, 2000) : null;
  const heartbeat = testLegacyModes ? setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, 15000) : null;

  try {
    await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(port, host, resolve); });
  } catch (error) {
    clearInterval(tick); clearInterval(saveTimer); clearInterval(heartbeat);
    wss.close();
    if (survival) await survival.stop();
    if (platform) await platform.stop();
    throw error;
  }
  async function stop() {
    if (stopping) return stopping;
    closed = true;
    stopping = (async () => {
      if (survival) await survival.stop();
      if (platform) await platform.stop();
      markDirty(); await flushSave();
      clearInterval(tick); clearInterval(saveTimer); clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      const forceClose = setTimeout(() => httpServer.closeAllConnections(), 2000);
      await new Promise(resolve => httpServer.close(resolve));
      clearTimeout(forceClose);
    })().catch(error => { closed = false; stopping = null; throw error; });
    return stopping;
  }
  return { port: httpServer.address().port, host, stop, flushSave, snapshot: state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const server = await createGameServer({ platform: true });
    console.log(`体素钓鱼服务已启动，端口 ${server.port}。按 Ctrl+C 保存并退出。`);
    let stopping = false;
    const shutdown = async () => { if (stopping) return; stopping = true; try { await server.stop(); process.exitCode = 0; } catch { console.error('存档写入失败，请检查服务器目录。'); process.exitCode = 1; } };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? '端口被占用，请关闭已有游戏服务器或修改 PORT。' : error.message); process.exitCode = 1; }
}
