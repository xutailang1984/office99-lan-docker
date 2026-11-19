const base = 'http://127.0.0.1:8080';

try {
  const health = await fetch(`${base}/health`, {signal: AbortSignal.timeout(3000)});
  if (!health.ok || !(await health.json()).ready) throw new Error('server not ready');
  const home = await fetch(base + '/', {signal: AbortSignal.timeout(3000)});
  if (!home.ok || !/^<!doctype html>/i.test(await home.text())) throw new Error('invalid home page');
  const moba = await fetch(base + '/moba/status', {signal: AbortSignal.timeout(3000)});
  if (!moba.ok || !(await moba.json()).enabled) throw new Error('MOBA not ready');
  for (const resource of ['/play.html', '/index.pck', '/index.wasm', '/platform/host-worker.mjs', '/platform/balance.json',
    '/moba-play.html', '/moba/app.mjs', '/moba/input-router.mjs', '/moba/host-worker.mjs', '/moba/sim/world.mjs']) {
    const response = await fetch(base + resource, {method: 'HEAD', signal: AbortSignal.timeout(3000)});
    if (!response.ok || Number(response.headers.get('content-length')) <= 0) throw new Error('missing resource');
  }
} catch {
  process.exitCode = 1;
}
