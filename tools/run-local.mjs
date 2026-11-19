import {access, mkdir} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const usage = 'Usage: node tools/run-local.mjs [--lan] [--port 8080] [--data-dir ./data] [--web-root release/web]';
const options = {port: 8080, host: '127.0.0.1', dataDir: path.join(root, 'data'), webRoot: path.join(root, 'release/web')};
const args = process.argv.slice(2);
while (args.length) {
  const option = args.shift();
  if (option === '--help' || option === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if (option === '--lan') {
    options.host = '0.0.0.0';
    continue;
  }
  const value = args.shift();
  if (!value || value.startsWith('--')) throw Error(usage);
  if (option === '--port' && /^\d{1,5}$/.test(value) && Number(value) <= 65535) options.port = Number(value);
  else if (option === '--data-dir') options.dataDir = path.resolve(value);
  else if (option === '--web-root') options.webRoot = path.resolve(value);
  else throw Error(usage);
}
if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
for (const file of ['index.html', 'play.html', 'index.pck', 'index.wasm', 'moba-play.html', 'moba/app.mjs']) {
  try {
    await access(path.join(options.webRoot, file));
  } catch {
    throw Error('Missing Web export: ' + file + '. Use release/web or rebuild with tools/build-candidate.mjs.');
  }
}

await mkdir(options.dataDir, {recursive: true});
const {createGameServer} = await import('../server/server.mjs');
try {
  const server = await createGameServer({
    host: options.host,
    port: options.port,
    platform: true,
    moba: true,
    economyVersion: 1,
    webRoot: options.webRoot,
    saveFile: path.join(options.dataDir, 'save.json'),
    platformDataDir: path.join(options.dataDir, 'platform-p1')
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await server.stop();
    } catch (error) {
      console.error('Office99 shutdown failed:', error.message);
      process.exitCode = 1;
      stopping = false;
    }
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log(JSON.stringify({ready: true, url: 'http://127.0.0.1:' + server.port, platform: process.platform, arch: process.arch}));
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? 'Port already in use. Choose another port with --port.' : error.message);
  process.exitCode = 1;
}
