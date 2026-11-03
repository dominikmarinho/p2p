import { performance } from 'node:perf_hooks';
const base = process.env.BENCHMARK_BASE ?? 'http://127.0.0.1:3001';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Benchmark restrito a loopback');
for (const path of ['/health/ready', '/api/admin/peers']) {
  const headers = path.includes('/admin/') ? { 'x-api-key': process.env.ADMIN_BOOTSTRAP_KEY ?? '' } : {};
  const times = []; let errors = 0; let cursor = 0; const start = performance.now();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor++ < 200) { const at = performance.now(); try { const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(5000) }); await response.arrayBuffer(); if (!response.ok) errors++; } catch { errors++; } times.push(performance.now() - at); }
  }));
  times.sort((a,b) => a-b); const percentile = (p) => Number(times[Math.min(times.length - 1, Math.ceil(p * times.length) - 1)].toFixed(2));
  console.log(JSON.stringify({ route: path, requests: times.length, concurrency: 4, errors, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), requestsPerSecond: Number((times.length / ((performance.now() - start)/1000)).toFixed(1)) }));
}
