import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

const usage = 'Usage: node tools/build-docker-release.mjs <unpacked-release-directory> [--tag <image:tag>] [--platform linux/amd64|linux/arm64]';
const args = process.argv.slice(2);
if (!args.length || args[0].startsWith('--')) throw Error(usage);
const releaseRoot = path.resolve(args.shift());
let tag = 'office99-lan:local';
let platform = null;
while (args.length) {
  const option = args.shift();
  if (option === '--tag' && args.length) tag = args.shift();
  else if (option === '--platform' && args.length) platform = args.shift();
  else throw Error(usage);
}
if (!tag || tag.startsWith('-') || /\s/.test(tag)) throw Error('Invalid Docker image tag');
if (platform !== null && !/^linux\/(?:amd64|arm64)$/.test(platform)) throw Error('Platform must be linux/amd64 or linux/arm64');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verified = spawnSync(process.execPath, [path.join(root, 'tools/verify-docker-release.mjs'), releaseRoot],
  {encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true});
if (verified.status !== 0) {
  throw Error(`Release verification failed: ${verified.error?.message ?? verified.stderr?.trim() ?? verified.status}`);
}
const manifest = JSON.parse(await readFile(path.join(releaseRoot, 'release-manifest.json'), 'utf8'));
const entries = Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b));
if (!entries.some(([name]) => name === 'Dockerfile')) throw Error('Dockerfile is missing from release manifest');

// A tar stream built by Node uses the bytes Node verified and read. On some
// managed Windows machines Docker Desktop's directory reader sees encrypted
// bytes even while a Windows Node process sees the intended release files.
const maxTarSize = 0o77777777777; // USTAR's eleven octal size digits: 8 GiB - 1.
function tarHeader(name, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > maxTarSize) throw Error(`Tar file is too large: ${name}`);
  const nameBytes = Buffer.from(name, 'utf8');
  let leaf = nameBytes;
  let prefix = Buffer.alloc(0);
  if (leaf.length > 100) {
    let found = false;
    for (let slash = name.lastIndexOf('/'); slash > 0; slash = name.lastIndexOf('/', slash - 1)) {
      const before = Buffer.from(name.slice(0, slash), 'utf8');
      const after = Buffer.from(name.slice(slash + 1), 'utf8');
      if (before.length <= 155 && after.length <= 100) {
        prefix = before;
        leaf = after;
        found = true;
        break;
      }
    }
    if (!found) throw Error(`Tar path exceeds USTAR limits: ${name}`);
  }
  const header = Buffer.alloc(512);
  const octal = (offset, length, value) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
  leaf.copy(header, 0);
  octal(100, 8, 0o644);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0); // Stable timestamp and permissions across Windows, Mac and Linux.
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  prefix.copy(header, 345);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

async function* tarChunks() {
  for (const [name, expected] of entries) {
    yield tarHeader(name, expected.bytes);
    const digest = createHash('sha256');
    let count = 0;
    for await (const chunk of createReadStream(path.join(releaseRoot, ...name.split('/')))) {
      count += chunk.length;
      digest.update(chunk);
      yield chunk;
    }
    if (count !== expected.bytes || digest.digest('hex') !== expected.sha256) {
      throw Error(`Release file changed during Docker build: ${name}`);
    }
    const padding = (512 - count % 512) % 512;
    if (padding) yield Buffer.alloc(padding);
  }
  yield Buffer.alloc(1024);
}

// Quiet build returns an image ID without changing any existing production tag.
const buildArgs = ['build', '--quiet'];
if (platform) buildArgs.push('--platform', platform);
buildArgs.push('-');
const build = spawn('docker', buildArgs, {stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true});
let buildOutput = '';
build.stdout.setEncoding('utf8');
build.stdout.on('data', chunk => {
  buildOutput += chunk;
  if (buildOutput.length > 65536) build.kill();
});
const buildFinished = new Promise(resolve => {
  build.once('error', error => resolve({error}));
  build.once('close', (code, signal) => resolve({code, signal}));
});
let streamError = null;
try {
  await pipeline(Readable.from(tarChunks(), {objectMode: false}), build.stdin);
} catch (error) {
  streamError = error;
  build.kill();
}
const buildResult = await buildFinished;
if (streamError) throw streamError;
if (buildResult.error) throw buildResult.error;
if (buildResult.code !== 0) throw Error(`Docker build failed with exit code ${buildResult.code}`);
const imageId = buildOutput.trim().split(/\s+/).at(-1);
if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('Docker did not return a verifiable image ID');

// Run only a read-only hash probe in the new image; do not start its game server.
const copied = entries.filter(([name]) => name.startsWith('server/') || name.startsWith('web/'));
const probe = `const fs=require('node:fs'),crypto=require('node:crypto');
const names=JSON.parse(process.argv[1]);const files=[];
for(const name of names){const bytes=fs.readFileSync('/app/'+name);
files.push([name,bytes.length,crypto.createHash('sha256').update(bytes).digest('hex')]);}
const html=fs.readFileSync('/app/web/index.html');
process.stdout.write(JSON.stringify({files,htmlPrefix:html.subarray(0,16).toString('utf8')}));`;
const runArgs = ['run', '--rm', '--network', 'none', '--read-only'];
if (platform) runArgs.push('--platform', platform);
runArgs.push('--entrypoint', 'node', imageId, '-e', probe, JSON.stringify(copied.map(([name]) => name)));
const inspected = spawnSync('docker', runArgs, {encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true});
if (inspected.status !== 0) {
  throw Error(`New image could not be verified: ${inspected.error?.message ?? inspected.stderr?.trim() ?? inspected.status}`);
}
const actual = JSON.parse(inspected.stdout);
if (!actual.htmlPrefix.toLowerCase().startsWith('<!doctype')) throw Error('New image contains an unreadable Web entry');
if (!Array.isArray(actual.files) || actual.files.length !== copied.length) throw Error('New image file count differs from release');
for (let i = 0; i < copied.length; i++) {
  const [name, expected] = copied[i];
  const [foundName, bytes, sha256] = actual.files[i] ?? [];
  if (name !== foundName || bytes !== expected.bytes || sha256 !== expected.sha256) {
    throw Error(`New image differs from verified release: ${name}`);
  }
}

const tagged = spawnSync('docker', ['image', 'tag', imageId, tag],
  {encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true});
if (tagged.status !== 0) throw Error(`Image verified but tagging failed: ${tagged.error?.message ?? tagged.stderr?.trim() ?? tagged.status}`);
console.log(JSON.stringify({ok: true, image: tag, imageId, platform: platform ?? 'docker-default',
  releaseVersion: manifest.version, filesVerified: copied.length}));
