const base = 'http://127.0.0.1:8080';

try {
  const health = await fetch(`${base}/health`, {signal: AbortSignal.timeout(3000)});
  if (!health.ok || !(await health.json()).ready) throw new Error('server not ready');
  const home = await fetch(base + '/', {signal: AbortSignal.timeout(3000)});
  if (!home.ok || !/^<!doctype html>/i.test(await home.text())) throw new Error('invalid home page');
  for (const resource of ['/play.html', '/index.pck', '/index.wasm', '/platform/host-worker.mjs', '/platform/balance.json']) {
    const response = await fetch(base + resource, {method: 'HEAD', signal: AbortSignal.timeout(3000)});
    if (!response.ok || Number(response.headers.get('content-length')) <= 0) throw new Error('missing resource');
  }
} catch {
  process.exitCode = 1;
}
