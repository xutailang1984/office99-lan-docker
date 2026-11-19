import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { verifyPortableRelease } from './smoke-portable.mjs';

const root = path.resolve(import.meta.dirname, '..');
const runtime = path.join(root, '.runtime');
await mkdir(runtime, {recursive: true});
const data = await mkdtemp(path.join(runtime, 'portable-test-'));
let child;
let origin;
let restarted = false;

async function launch() {
  child = spawn(process.execPath, ['tools/run-local.mjs', '--port', origin ? new URL(origin).port : '0', '--data-dir', data], {
    cwd: root, stdio: ['ignore', 'pipe', 'inherit']
  });
  child.on('error', error => console.error(error.message));
  const output = createInterface({input: child.stdout});
  let timer;
  try {
    const report = await Promise.race([
      once(output, 'line').then(([line]) => JSON.parse(line)),
      once(child, 'exit').then(([code]) => { throw Error('Server exited before ready: ' + code); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Server did not become ready')), 30_000); })
    ]);
    if (!report.ready || (origin && report.url !== origin)) throw Error('Unexpected launch address');
    origin = report.url;
    console.log(JSON.stringify({platform: report.platform, arch: report.arch, restarted}));
  } finally {
    clearTimeout(timer);
    output.close();
    child.stdout.resume();
  }
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const current = child;
  const closed = once(current, 'exit');
  const deadline = setTimeout(() => current.kill('SIGKILL'), 20_000);
  try {
    current.kill('SIGTERM');
    const [code, signal] = await closed;
    if (process.platform !== 'win32' && (code !== 0 || signal)) throw Error('Server did not shut down cleanly');
  } finally {
    clearTimeout(deadline);
  }
}
try {
  await launch();
  const result = await verifyPortableRelease(origin, {
    isolated: true,
    restart: process.platform === 'win32' ? undefined : async () => {
      await stop();
      restarted = true;
      await launch();
    }
  });
  console.log(JSON.stringify(result));
  if (process.argv.includes('--browser')) {
    const {verifyPortableBrowser} = await import('./smoke-portable-browser.mjs');
    console.log(JSON.stringify(await verifyPortableBrowser(origin, {isolated: true})));
  }
} finally {
  try { await stop(); } finally { await rm(data, {recursive: true, force: true}); }
}
