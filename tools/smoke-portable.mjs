import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const releaseRoot = new URL('../release/', import.meta.url);
const assets = [
  ['/', 'web/index.html'],
  ['/play.html', 'web/play.html'],
  ['/index.js', 'web/index.js'],
  ['/index.pck', 'web/index.pck'],
  ['/index.wasm', 'web/index.wasm'],
  ['/platform/app.mjs', 'web/platform/app.mjs'],
  ['/platform/host-worker.mjs', 'web/platform/host-worker.mjs'],
  ['/moba/index.html', 'web/moba/index.html'],
  ['/moba-play.html', 'web/moba-play.html'],
  ['/moba/app.mjs', 'web/moba/app.mjs'],
  ['/moba/input-router.mjs', 'web/moba/input-router.mjs'],
  ['/moba/host-worker.mjs', 'web/moba/host-worker.mjs'],
  ['/moba/sim/world.mjs', 'web/moba/sim/world.mjs'],
  ['/moba/sim/map.mjs', 'web/moba/sim/map.mjs'],
  ['/moba/sim/catalog.mjs', 'web/moba/sim/catalog.mjs'],
  ['/moba/sim/wire.mjs', 'web/moba/sim/wire.mjs'],
];

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(origin, route, options = {}) {
  return fetch(origin + route, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
}

async function json(origin, route, options = {}, expected = 200) {
  const response = await request(origin, route, options);
  requireCheck(response.status === expected, `${options.method ?? 'GET'} ${route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<test-id>')}: HTTP ${response.status}`);
  return { body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';', 1)[0] };
}

function api(origin, route, { method = 'GET', data, cookie, expected } = {}) {
  const headers = { Origin: origin };
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  return json(origin, `/api/platform${route}`, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  }, expected);
}

function connect(WebSocket, origin, endpoint, cookie, sockets) {
  const url = new URL(endpoint, origin);
  url.protocol = 'ws:';
  const socket = new WebSocket(url, { headers: { Origin: origin, Cookie: cookie }, handshakeTimeout: 10000 });
  const messages = [];
  let failure = null;
  sockets.push(socket);
  socket.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'error') {
        failure = new Error(`${endpoint}: ${String(message.code ?? 'server error').replace(/[^A-Z_ ]/gi, '')}`);
      } else {
        messages.push(message);
      }
    } catch {
      failure = new Error(`${endpoint}: malformed server message`);
    }
  });
  socket.on('error', () => { failure ??= new Error(`${endpoint}: connection failed`); });
  socket.on('close', code => { failure ??= new Error(`${endpoint}: socket closed (${code})`); });
  return {
    send(message) { socket.send(JSON.stringify(message)); },
    async wait(type, matches = () => true) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (failure) throw failure;
        const index = messages.findIndex(message => message.type === type && matches(message));
        if (index >= 0) return messages.splice(index, 1)[0];
        await delay(15);
      }
      throw new Error(`${endpoint}: timed out waiting for ${type}`);
    },
  };
}

async function exerciseRooms(origin, WebSocket, sockets) {
  const accounts = [];
  for (const name of ['验证房主', '验证队友']) {
    const credentials = {
      username: `smoke-${randomBytes(8).toString('hex')}`,
      password: randomBytes(24).toString('base64url'),
    };
    const response = await api(origin, '/register', {
      method: 'POST', data: { ...credentials, name }, expected: 201,
    });
    requireCheck(!!response.cookie && !!response.body.account?.id, 'Synthetic registration did not create a session');
    accounts.push({ ...credentials, id: response.body.account.id, cookie: response.cookie });
  }
  const [host, guest] = accounts;
  const platform = accounts.map(account => connect(WebSocket, origin, '/platform/signal', account.cookie, sockets));
  const sessions = await Promise.all(platform.map(peer => peer.wait('session')));
  requireCheck(sessions[0].self.accountId === host.id && sessions[1].self.accountId === guest.id, 'PVE session identity mismatch');

  const { body: { adventure } } = await api(origin, '/adventures', {
    method: 'POST', data: { title: '跨平台验证冒险' }, cookie: host.cookie, expected: 201,
  });
  requireCheck(!!adventure?.id && adventure.economyVersion === 1, 'PVE adventure or career configuration missing');
  const { body: { room } } = await api(origin, '/rooms', {
    method: 'POST', data: { adventureId: adventure.id, solo: false }, cookie: host.cookie, expected: 201,
  });
  requireCheck(room?.status === 'waiting' && room.members.length === 1, 'PVE room creation failed');
  const pveRoom = (action, account, data = {}) => api(origin, `/rooms/${room.id}/${action}`, {
    method: 'POST', data, cookie: account.cookie,
  });
  const joined = await pveRoom('join', guest);
  requireCheck(joined.body.room?.members.length === 2, 'PVE room join failed');
  for (const peer of platform) peer.send({ type: 'ready', ready: true });
  await platform[0].wait('room', message => message.room?.id === room.id && message.room.members.length === 2 && message.room.members.every(member => member.ready));
  requireCheck((await pveRoom('start', host, { epoch: room.epoch })).body.room?.status === 'running', 'PVE room start failed');
  const chat = '跨平台联机验证';
  platform[1].send({ type: 'chat', text: chat });
  await platform[0].wait('chat', message => message.message?.text === chat);
  requireCheck((await pveRoom('leave', guest)).body.left === true, 'PVE guest leave failed');
  requireCheck((await pveRoom('close', host, { epoch: room.epoch, finalRevision: 0 })).body.closed === true, 'PVE host close failed');
  requireCheck((await api(origin, '/adventures', { cookie: host.cookie })).body.adventures.some(row => row.id === adventure.id && row.status === 'paused'), 'PVE adventure did not return to the saved list');

  const [a, b] = accounts.map(account => connect(WebSocket, origin, '/moba/socket', account.cookie, sockets));
  const welcomes = await Promise.all([a.wait('welcome'), b.wait('welcome')]);
  a.send({ type: 'create', title: '跨平台验证对局' });
  const moba = (await a.wait('room', message => message.room?.status === 'waiting')).room;
  await b.wait('rooms', message => message.rooms.some(row => row.id === moba.id));
  b.send({ type: 'join', roomId: moba.id });
  await b.wait('room', message => message.room?.id === moba.id && message.room.roster.length === 2);
  a.send({ type: 'ready' });
  b.send({ type: 'ready' });
  await a.wait('room', message => message.room?.id === moba.id && message.room.roster.length === 2 && message.room.roster.every(seat => seat.ready));
  a.send({ type: 'begin' });
  const initial = await a.wait('host_init');
  const loading = (await a.wait('room', message => message.room?.id === moba.id && message.room.status === 'loading')).room;
  requireCheck(initial.roster?.length === 10 && initial.roster.filter(seat => seat.bot).length === 8, 'MOBA did not fill the match seats');
  for (const [index, welcome] of welcomes.entries()) {
    requireCheck(initial.roster.some(seat => seat.peerId === welcome.self.peerId && seat.team === index), 'MOBA team assignment mismatch');
  }
  a.send({ type: 'host_ready', epoch: loading.epoch });
  a.send({ type: 'loaded', epoch: loading.epoch });
  b.send({ type: 'loaded', epoch: loading.epoch });
  await b.wait('room', message => message.room?.id === moba.id && message.room.status === 'running');
  b.send({ type: 'leave' });
  await b.wait('room', message => message.room === null);
  a.send({ type: 'leave' });
  a.send({ type: 'list' });
  await a.wait('rooms', message => !message.rooms.some(row => row.id === moba.id));
  return { host, adventureId: adventure.id };
}

export async function verifyPortableRelease(address, { isolated = false, restart } = {}) {
  const url = new URL(address);
  requireCheck(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Supply an HTTP loopback origin');
  requireCheck(!isolated || (url.port && url.port !== '8080'), 'Use a dedicated non-8080 test port and temporary data for --isolated');
  requireCheck(!restart || isolated, 'Restart checking requires isolated test data');
  const origin = url.origin;
  const manifest = JSON.parse(await readFile(new URL('release-manifest.json', releaseRoot), 'utf8'));
  const expectedMoba = (await readFile(new URL('server/moba/catalog.mjs', releaseRoot), 'utf8'))
    .match(/export const VERSION\s*=\s*['"](moba-[\d.]+)['"]/)?.[1];
  requireCheck(!!expectedMoba, 'MOBA version missing from the distributed catalog');
  async function readVersions() {
    const [{ body: health }, { body: moba }] = await Promise.all([
      json(origin, '/health'), json(origin, '/moba/status'),
    ]);
    requireCheck(health.ready && health.platform?.ready && health.build === manifest.version, 'PVE is unavailable or running a different version');
    requireCheck(moba.enabled && moba.version === expectedMoba, 'MOBA is unavailable or running a different version');
    return { health, moba };
  }
  const { health, moba } = await readVersions();
  for (const [route, file] of assets) {
    const expected = manifest.files[file];
    requireCheck(!!expected, `Asset missing from manifest: ${file}`);
    const response = await request(origin, route);
    requireCheck(response.ok, `Could not load ${route}`);
    const content = Buffer.from(await response.arrayBuffer());
    requireCheck(content.length === expected.bytes && createHash('sha256').update(content).digest('hex') === expected.sha256, `Asset differs from release manifest: ${route}`);
  }
  const verified = { passed: true, hostPlatform: process.platform, hostArch: process.arch, pve: health.build, moba: moba.version, verifiedAssets: assets.length };
  if (!isolated) return verified;

  requireCheck(health.platform.rooms === 0 && health.platform.online === 0 && health.platform.storage?.adventures === 0 && moba.rooms === 0 && health.moba?.online === 0,
    'Isolated test requires an empty deployment with no existing adventures or players');
  const dependencyPackage = process.env.OFFICE99_SMOKE_SERVER_DIR
    ? path.join(path.resolve(process.env.OFFICE99_SMOKE_SERVER_DIR), 'package.json')
    : new URL('../server/package.json', import.meta.url);
  const { WebSocket } = createRequire(dependencyPackage)('ws');
  const sockets = [];
  let fixture;
  try {
    fixture = await exerciseRooms(origin, WebSocket, sockets);
  } finally {
    for (const socket of sockets) socket.terminate();
  }
  const after = await readVersions();
  requireCheck(after.health.platform.rooms === 0 && after.moba.rooms === 0, 'Test room remained open');
  verified.pveLobby = 'create, join, ready, start, chat, close, adventure listed';
  verified.mobaLobby = 'create, list, join, ready, start, leave';
  if (restart) {
    await restart();
    await readVersions();
    const { host, adventureId } = fixture;
    const login = await api(origin, '/login', {
      method: 'POST', data: { username: host.username, password: host.password },
    });
    requireCheck(!!login.cookie && login.body.account?.id === host.id, 'Synthetic account did not survive the restart');
    const adventures = await api(origin, '/adventures', { cookie: login.cookie });
    requireCheck(adventures.body.adventures.some(row => row.id === adventureId && row.status === 'paused'), 'Synthetic adventure did not survive the restart');
    verified.restartPersistence = 'account and adventure restored';
  }
  return verified;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [origin, flag, ...extra] = process.argv.slice(2);
  if (!origin || (flag && flag !== '--isolated') || extra.length) {
    process.stderr.write(`Usage: node ${path.basename(fileURLToPath(import.meta.url))} <loopback-origin> [--isolated]\n`);
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await verifyPortableRelease(origin, { isolated: flag === '--isolated' })));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
