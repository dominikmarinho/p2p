import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile as execCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { xuiFixture } from '../helpers/xui-fixture.js';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
import { RokuRelay } from '../../src/modules/iptv/roku-relay.js';
import type { Playback } from '../../apps/webplayer/src/api.js';
if (process.env.NODE_ENV !== 'test') throw new Error('NODE_ENV=test obrigatório');
const folder = await mkdtemp(join(tmpdir(), 'highpass-redundancy-'));
const execFile = promisify(execCallback);
await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '24', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '24', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_segment_filename', join(folder, 'chunk%d.ts'), join(folder, 'index.m3u8')]);
const source = xuiFixture(folder); let mediaRequests = 0;
source.addHook('onRequest', (request, _reply, done) => { if (request.url.startsWith('/hls/chunk')) mediaRequests++; done(); });
const origin = await source.listen({ host: '127.0.0.1', port: 0 });
const app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', P2P_DELIVERY_ENABLED: 'true', P2P_SEED_ENABLED: 'true', P2P_SEED_WORKERS: '2', RTC_ICE_SERVERS: '[]', RATE_LIMIT_MAX: '10000', RATE_LIMIT_NAMESPACE: `replicas:${randomUUID()}:` }));
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const context = await browser.newContext(); const admin = { 'x-api-key': 'local-admin-key-change-before-production' };
let blocked = false;
// Preserve the method and explicitly restore its receiver in the failover harness.
// eslint-disable-next-line @typescript-eslint/unbound-method
const startSeed = RokuRelay.prototype.startSeed;
RokuRelay.prototype.startSeed = function(...args) { return blocked ? Promise.resolve(false) : startSeed.apply(this, args); };
type Snapshot = { readyWorkers: number; active: number; streams: { swarm: string; workers: { role: string; originBytes: number; ready: boolean }[] }[] };
const snapshot = async () => (await app.inject({ url: '/api/admin/seeds', headers: admin })).json<Snapshot>();
try {
  assert.equal((await context.request.post(address + '/api/iptv/login', { data: { username: 'alice', password: 'secret-line' } })).status(), 200);
  const descriptor = await (await context.request.post(address + '/api/iptv/playback', { data: { kind: 'live', id: '1', transport: 'p2p' } })).json() as Playback;
  assert.ok(descriptor.delivery); const lease = setInterval(() => { void context.request.post(address + descriptor.delivery!.seedPath, { data: { position: 0 } }).catch(() => undefined); }, 5000);
  try {
    let warmed = false;
    for (let index = 0; index < 150; index++) { if ((await snapshot()).readyWorkers === 2) { warmed = true; break; } await new Promise<void>((resolve) => setTimeout(resolve, 200)); }
    assert.ok(warmed, JSON.stringify(await snapshot()));
    const state = await snapshot(); assert.equal(state.streams[0]?.workers.find((worker) => worker.role === 'replica')?.originBytes, 0);
    blocked = true; assert.equal((await app.inject({ method: 'POST', url: `/api/admin/seeds/${descriptor.swarmId}/restart`, headers: admin })).statusCode, 200);
    const requestsBefore = mediaRequests;
    const page = await context.newPage();
    await page.addInitScript(() => {
      const state = { done: false, failed: false, bytes: 0, http: 0 };
      Object.assign(window, { replicaTest: state, NativeSegments: { ready() {}, stats(raw: string) { state.http = (JSON.parse(raw) as { httpDownloaded: number }).httpDownloaded; }, complete(_id: string, chunk: string, done: boolean) { state.bytes += atob(chunk).length; state.done = done; }, fallback() { state.failed = true; } } });
    });
    await page.goto(address + '/player/android-bridge.html'); await page.waitForFunction(() => Boolean(window.HighpassBridge));
    const text = await (await context.request.get(address + descriptor.url)).text(); assert.match(text, /#EXT-X-SERVER-CONTROL:HOLD-BACK=16/);
    const target = text.split('\n').filter((line) => line.startsWith('/api/iptv/media/')).at(-3); assert.ok(target);
    assert.equal((await context.request.get(address + target)).status(), 403, 'HTTP de vídeo do player permanece bloqueado');
    await page.evaluate(({ descriptor, text, address, target }) => { window.HighpassBridge.init(descriptor, true); window.HighpassBridge.playlist(address + descriptor.url, text); window.HighpassBridge.load('replica-only', address + target, 0, -1); }, { descriptor, text, address, target });
    await page.waitForFunction(() => { const state = (window as unknown as { replicaTest: { done: boolean; failed: boolean } }).replicaTest; return state.done || state.failed; }, undefined, { timeout: 25000 });
    const received = await page.evaluate(() => (window as unknown as { replicaTest: { done: boolean; failed: boolean; bytes: number; http: number } }).replicaTest);
    assert.equal(received.failed, false); assert.ok(received.done && received.bytes > 0); assert.equal(received.http, 0); assert.equal(mediaRequests, requestsBefore, 'Réplica não consulta vídeo no XUI durante a falha do alimentador');
    blocked = false;
    for (let index = 0; index < 100; index++) { if ((await snapshot()).readyWorkers === 2) break; await new Promise<void>((resolve) => setTimeout(resolve, 200)); }
    assert.equal((await snapshot()).readyWorkers, 2, 'Alimentador deve retornar sem reiniciar o player');
    await context.request.delete(address + descriptor.delivery.seedPath); assert.equal((await snapshot()).active, 0);
    console.log(`Redundância aprovada: dois workers, réplica com zero HTTP de vídeo, ${received.bytes} bytes P2P durante falha do alimentador, retorno automático e encerramento de ambos`);
  } finally { clearInterval(lease); }
} finally { blocked = false; RokuRelay.prototype.startSeed = startSeed; await context.close(); await browser.close(); await app.close(); await source.close(); await rm(folder, { recursive: true, force: true }); }
