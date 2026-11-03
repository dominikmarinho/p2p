import assert from 'node:assert/strict';
import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { xuiFixture } from '../helpers/xui-fixture.js';
import type { Playback } from '../../apps/webplayer/src/api.js';
import type { AndroidBridgeApi } from '../../apps/webplayer/src/p2p/android-bridge.js';
const execFile = promisify(callback);
if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL?.includes('highpass_test')) throw new Error('Banco exclusivo de teste obrigatório');
const folder = await mkdtemp(join(tmpdir(), 'highpass-container-'));
await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '16', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_segment_filename', join(folder, 'chunk%d.ts'), join(folder, 'index.m3u8')]);
const source = xuiFixture(folder, 1); const origin = await source.listen({ host: '127.0.0.1', port: 0 });
const name = `highpass-container-proof-${randomUUID()}`; const address = 'http://127.0.0.1:18300';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
try {
  const values = { NODE_ENV: 'test', LOG_LEVEL: 'silent', HOST: '127.0.0.1', PORT: '18300', DATABASE_URL: process.env.DATABASE_URL, REDIS_HOST: '127.0.0.1', REDIS_PORT: process.env.REDIS_PORT ?? '16379', REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? '', JWT_SECRET: process.env.JWT_SECRET ?? '', XUI_ALLOW_HTTP: 'true', XUI_BASE_URL: origin, XUI_ALLOWED_HOSTS: '127.0.0.1', P2P_SEED_ENABLED: 'true', P2P_DELIVERY_ENABLED: 'true', RTC_ICE_SERVERS: '[]', RATE_LIMIT_MAX: '10000', RATE_LIMIT_NAMESPACE: `container:${randomUUID()}:` };
  await execFile('docker', ['run', '-d', '--name', name, '--network', 'host', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:size=256m,noexec,nosuid', '--tmpfs', '/cache/vod:size=128m,uid=1000,gid=1000', ...Object.entries(values).flatMap(([key, value]) => ['-e', `${key}=${value}`]), process.env.SEED_TEST_CONTAINER_IMAGE ?? 'highpass-seed-proof:local']);
  for (let attempt = 0; attempt < 60; attempt++) { if ((await fetch(address + '/health/ready').catch(() => undefined))?.ok) break; await new Promise<void>((resolve) => setTimeout(resolve, 300)); }
  const context = await browser.newContext(); assert.equal((await context.request.post(address + '/api/iptv/login', { data: { username: 'alice', password: 'secret-line' } })).status(), 200);
  const playback = await (await context.request.post(address + '/api/iptv/playback', { data: { kind: 'live', id: '1' } })).json() as Playback; assert.ok(playback.delivery);
  assert.equal((await context.request.post(address + playback.delivery.seedPath, { data: { position: 0 } })).status(), 200);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { const state = await (await context.request.get(address + '/api/admin/seeds', { headers: { 'x-api-key': 'local-admin-key-change-before-production' } })).json() as { ready: number }; if (state.ready) { ready = true; break; } await new Promise<void>((resolve) => setTimeout(resolve, 300)); } assert.ok(ready, 'Chromium do runtime deve aquecer o seed com filesystem somente leitura');
  const page = await context.newPage(); await page.addInitScript(`window.result={done:false,failed:false,chunks:[]};window.NativeSegments={ready:function(){window.ready=true},stats:function(){},complete:function(id,chunk,done){window.result.chunks.push(chunk);window.result.done=done},fallback:function(){window.result.failed=true}}`);
  await page.goto(address + '/player/android-bridge.html'); const text = await (await context.request.get(address + playback.url)).text(); const target = text.split('\n').find((line) => line.startsWith('/api/iptv/media/')); assert.ok(target);
  await page.route('**/api/iptv/media/**', (route) => route.abort());
  await page.evaluate(({ playback, text, root, segment }) => { const bridge = (window as unknown as { HighpassBridge: AndroidBridgeApi }).HighpassBridge; bridge.init(playback, true); bridge.playlist(root, text); bridge.load('one', segment, 0, -1); }, { playback, text, root: address + playback.url, segment: address + target });
  await page.waitForFunction(() => (window as unknown as { result: { done: boolean } }).result.done, undefined, { timeout: 25000 });
  const state = await page.evaluate(() => (window as unknown as { result: { failed: boolean; chunks: string[] } }).result); assert.equal(state.failed, false);
  const actual = Buffer.concat(state.chunks.map((part) => Buffer.from(part, 'base64'))); const expected = await readFile(join(folder, 'chunk0.ts'));
  assert.equal(createHash('sha256').update(actual).digest('hex'), createHash('sha256').update(expected).digest('hex'));
  console.log(`Runtime Docker aprovado: uid node, filesystem read-only, seed Chromium → ${actual.length} bytes P2P, HTTP do receptor bloqueado, SHA-256 idêntico`);
} finally { await browser.close(); await execFile('docker', ['rm', '-f', name]).catch(() => undefined); await source.close(); await rm(folder, { recursive: true, force: true }); }
