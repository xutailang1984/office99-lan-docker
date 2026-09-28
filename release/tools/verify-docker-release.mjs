import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {lstat, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 1 && !(args.length === 2 && args[0] === '--release-root')) {
  throw Error('Usage: node tools/verify-docker-release.mjs <unpacked-release-directory>');
}
const root = path.resolve(args.at(-1));
const manifestName = 'release-manifest.json';
const requiredFiles = [
  'Dockerfile', '.dockerignore', 'compose.yaml', 'docker/healthcheck.mjs',
  'docs/DOCKER-DEPLOYMENT.md', 'tools/verify-docker-release.mjs',
  'tools/build-docker-release.mjs',
  'server/package.json', 'server/package-lock.json', 'server/server.mjs',
  'server/platform/service.mjs', 'server/survival/member-progress.mjs',
  'web/index.html', 'web/play.html', 'web/index.js', 'web/index.wasm',
  'web/index.pck', 'web/platform/app.mjs', 'web/platform/host-worker.mjs',
  'web/platform/balance.json', 'web/audio/sfx/manifest.json',
];
const hex = /^[a-f0-9]{64}$/;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(condition, message) {
  if (!condition) throw Error(message);
}
function validRelative(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.includes('\0') || path.posix.isAbsolute(name)) return false;
  const segments = name.split('/');
  return segments.every(segment => segment && segment !== '.' && segment !== '..' && !/[. ]$/.test(segment));
}
function forbidden(name) {
  const segments = name.split('/');
  return segments.some(segment => ['.git', '.runtime', '.work', 'node_modules', 'docker-data'].includes(segment)) ||
    name.startsWith('server/data/') || name === 'server/data';
}
function location(relative) {
  const target = path.resolve(root, ...relative.split('/'));
  need(target.startsWith(root + path.sep), 'Manifest path escapes release directory');
  return target;
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

need((await lstat(root)).isDirectory(), 'Release root must be a directory');
const manifest = JSON.parse(await readFile(path.join(root, manifestName), 'utf8'));
need(plainObject(manifest) && manifest.schema === 1 && /^\d+\.\d+\.\d+$/.test(manifest.version) &&
  ['verified-release', 'workspace-export'].includes(manifest.source) && plainObject(manifest.files),
  'Invalid release manifest');
const entries = Object.entries(manifest.files);
need(entries.length > 0 && Number.isSafeInteger(manifest.fileCount) && manifest.fileCount === entries.length,
  'Release manifest file count does not match its entries');
const expected = new Set();
const expectedDirectories = new Set(['docker-data']);
for (const [relative, value] of entries) {
  need(validRelative(relative) && relative !== manifestName && !forbidden(relative), 'Invalid or forbidden release path');
  need(plainObject(value) && Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && hex.test(value.sha256),
  `Invalid file fingerprint: ${relative}`);
  expected.add(relative);
  const parts = relative.split('/');
  for (let i = 1; i < parts.length; i++) expectedDirectories.add(parts.slice(0, i).join('/'));
}
for (const relative of requiredFiles) need(expected.has(relative), `Required release file missing: ${relative}`);

const actual = new Set();
const actualDirectories = new Set();
async function walk(directory = '') {
  for (const item of await readdir(directory ? location(directory) : root, {withFileTypes: true})) {
    const relative = directory ? `${directory}/${item.name}` : item.name;
    const info = await lstat(location(relative));
    need(!info.isSymbolicLink(), `Symbolic link is not allowed: ${relative}`);
    if (info.isDirectory()) {
      need(expectedDirectories.has(relative), `Unexpected release directory: ${relative}`);
      actualDirectories.add(relative);
      await walk(relative);
    } else if (info.isFile()) {
      need(relative === manifestName || expected.has(relative), `Unexpected release file: ${relative}`);
      actual.add(relative);
    } else throw Error(`Unsupported release entry: ${relative}`);
  }
}
await walk();
need(actual.has(manifestName), 'Release manifest is missing');
need(actualDirectories.has('docker-data'), 'Empty docker-data directory is missing');
need(actual.size - 1 === entries.length && expectedDirectories.size === actualDirectories.size,
  'Release file or directory count does not match manifest');

let bytes = 0;
for (const [relative, fingerprint] of entries) {
  need(actual.has(relative), `Release file missing: ${relative}`);
  const info = await lstat(location(relative));
  need(info.isFile() && info.size === fingerprint.bytes, `Release file size differs: ${relative}`);
  need((await sha256(location(relative))) === fingerprint.sha256, `Release file hash differs: ${relative}`);
  bytes += info.size;
}
const serverPackage = JSON.parse(await readFile(location('server/package.json'), 'utf8'));
need(serverPackage.version === manifest.version, 'Server and release versions differ');
console.log(JSON.stringify({ok: true, version: manifest.version, fileCount: entries.length,
  bytes, pckSha256: manifest.files['web/index.pck'].sha256}));
