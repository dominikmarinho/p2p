import assert from 'node:assert/strict';
import { execFile as execCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
import { xuiFixture } from '../helpers/xui-fixture.js';
import type { Playback } from '../../apps/webplayer/src/api.js';
import type { AndroidBridgeApi } from '../../apps/webplayer/src/p2p/android-bridge.js';

type State = { ready: boolean; id: string; done: boolean; failed: boolean; chunks: string[]; stats: { httpDownloaded: number; p2pDownloaded: number; peers: number } };
type TestWindow = Window & { seedTest: State; HighpassBridge: AndroidBridgeApi };
const execFile = promisify(execCallback);
if (process.env.NODE_ENV !== 'test') throw new Error('NODE_ENV=test obrigatório');
const folder = await mkdtemp(join(tmpdir(), 'highpass-seed-'));
await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '400', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '24', '-movflags', '+faststart', join(folder, 'movie.mp4')]);
await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(folder, 'movie.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_segment_filename', join(folder, 'chunk%d.ts'), join(folder, 'full.m3u8')]);
const manifest = (offset: number) => '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:' + offset + '\n' + Array.from({ length: 8 }, (_, index) => `#EXTINF:4.000,\nchunk${index + offset}.ts\n`).join('');
await writeFile(join(folder, 'index.m3u8'), manifest(0));
const source = xuiFixture(folder, 1); const origin = await source.listen({ host: '127.0.0.1', port: 0 });
const app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', P2P_DELIVERY_ENABLED: 'true', P2P_SEED_ENABLED: 'true', RTC_ICE_SERVERS: '[]', VOD_CACHE_DIR: folder, RATE_LIMIT_MAX: '10000', RATE_LIMIT_NAMESPACE: `seed-proof:${randomUUID()}:` }));
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
const admin = { 'x-api-key': 'local-admin-key-change-before-production' };
async function native(kind: 'live' | 'movie' | 'episode'): Promise<{ context: BrowserContext; page: Page; playback: Playback }> {
  const context = await browser.newContext();
  await context.request.post(address + '/api/iptv/login', { data: { username: 'alice', password: 'secret-line' } });
  const response = await context.request.post(address + '/api/iptv/playback', { data: { kind, id: kind === 'live' ? '1' : kind === 'movie' ? '2' : '4', ...(kind === 'episode' ? { seriesId: '3' } : {}) } }); assert.equal(response.status(), 200);
  const playback = await response.json() as Playback; assert.equal(playback.delivery?.mode, 'p2p-first');
  const page = await context.newPage();
  await page.addInitScript(`window.seedTest={ready:false,id:'',done:false,failed:false,chunks:[],stats:{httpDownloaded:0,p2pDownloaded:0,peers:0}};window.NativeSegments={ready:function(){window.seedTest.ready=true;},stats:function(raw){window.seedTest.stats=JSON.parse(raw);},complete:function(id,chunk,done){if(id===window.seedTest.id){window.seedTest.chunks.push(chunk);window.seedTest.done=done;}},fallback:function(id){if(id===window.seedTest.id)window.seedTest.failed=true;}};`);
  await page.goto(address + '/player/android-bridge.html'); await page.waitForFunction(() => (window as unknown as TestWindow).seedTest.ready);
  const text = await (await context.request.get(address + playback.url)).text(); assert.ok(text.startsWith('#EXTM3U'));
  // VOD is generated progressively. Start with its first three segments so
  // this test also exercises the native player's later playlist refresh.
  const lines = text.split('\n'); let count = 0;
  const thirdSegment = lines.findIndex((line) => line.endsWith('.ts') && ++count === 3);
  const initial = kind === 'movie' && thirdSegment >= 0 ? lines.slice(0, thirdSegment + 1).join('\n') : text;
  await page.evaluate(({ descriptor, text, uri }) => { const target = window as unknown as TestWindow; target.HighpassBridge.init(descriptor, true); target.HighpassBridge.playlist(uri, text); }, { descriptor: playback, text: initial, uri: address + playback.url });
  return { context, page, playback };
}
async function ready(swarm: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const data = (await app.inject({ url: '/api/admin/seeds', headers: admin })).json<{ streams: { swarm: string; ready: boolean }[] }>();
    if (data.streams.some((seed) => seed.swarm === swarm && seed.ready)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Seed não aqueceu segmentos');
}
async function load(page: Page, id: string, uri: string) {
  await page.evaluate(({ id, uri }) => { const target = window as unknown as TestWindow; Object.assign(target.seedTest, { id, chunks: [], done: false, failed: false }); target.HighpassBridge.load(id, uri, 0, -1); }, { id, uri });
  await page.waitForFunction(() => { const state = (window as unknown as TestWindow).seedTest; return state.done || state.failed; }, undefined, { timeout: 18000 });
  const state = await page.evaluate(() => (window as unknown as TestWindow).seedTest); assert.equal(state.failed, false, `Segmento ${id} deve ser entregue: ${JSON.stringify(state.stats)}`);
  return Buffer.concat(state.chunks.map((chunk) => Buffer.from(chunk, 'base64')));
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const blockMedia = async (page: Page) => page.route('**/api/iptv/**', (route) => { const path = new URL(route.request().url()).pathname; return (path.includes('/media/') || path.includes('/vod/')) && !path.endsWith('.m3u8') ? route.abort() : route.continue(); });
try {
  const live = await native('live'); await blockMedia(live.page); await ready(live.playback.swarmId);
  const first = await (await live.context.request.get(address + live.playback.url)).text(); const urls = first.split('\n').filter((line) => line.startsWith('/api/iptv/media/')); assert.equal(urls.length, 8);
  const bytes = await load(live.page, 'solo', address + urls[4]); assert.equal(hash(bytes), hash(await readFile(join(folder, 'chunk4.ts'))));
  await live.page.waitForFunction(() => (window as unknown as TestWindow).seedTest.stats.p2pDownloaded > 0);
  const before = await live.page.evaluate(() => (window as unknown as TestWindow).seedTest.stats.p2pDownloaded);
  console.log(`Seed sozinho → Android/Core: ${bytes.length} bytes P2P, HTTP do receptor bloqueado, SHA-256 idêntico`);
  assert.equal((await app.inject({ method: 'POST', url: `/api/admin/seeds/${live.playback.swarmId}/restart`, headers: admin })).statusCode, 200);
  await live.page.unroute('**/api/iptv/**');
  const fallback = await load(live.page, 'http-fallback', address + urls[0]); assert.equal(hash(fallback), hash(await readFile(join(folder, 'chunk0.ts'))));
  await live.page.waitForFunction(() => (window as unknown as TestWindow).seedTest.stats.httpDownloaded > 0);
  await writeFile(join(folder, 'index.m3u8'), manifest(8));
  const updated = await (await live.context.request.get(address + live.playback.url)).text();
  await live.page.evaluate(({ text, uri }) => (window as unknown as TestWindow).HighpassBridge.playlist(uri, text), { text: updated, uri: address + live.playback.url });
  await ready(live.playback.swarmId);
  await live.page.waitForFunction(() => (window as unknown as TestWindow).seedTest.stats.peers > 0);
  await live.page.waitForTimeout(2200); await blockMedia(live.page);
  const later = updated.split('\n').filter((line) => line.startsWith('/api/iptv/media/'));
  const recovered = await load(live.page, 'p2p-recovered', address + later[4]); assert.equal(hash(recovered), hash(await readFile(join(folder, 'chunk12.ts'))));
  await live.page.waitForFunction((old) => (window as unknown as TestWindow).seedTest.stats.p2pDownloaded > old, before);
  console.log('Recuperação aprovada no mesmo Core: seed interrompido → HTTP → P2P após recuperação, sem reiniciar o player');
  await live.page.evaluate(() => (window as unknown as TestWindow).HighpassBridge.destroy()); await live.context.close();
  for (const kind of ['movie', 'episode'] as const) {
    const viewer = await native(kind); await blockMedia(viewer.page); await ready(viewer.playback.swarmId);
    const text = await (await viewer.context.request.get(address + viewer.playback.url)).text(); const target = text.split('\n').find((line) => line.endsWith('chunk000000.ts')); assert.ok(target);
    const received = await load(viewer.page, kind, address + target); const expected = await (await viewer.context.request.get(address + target)).body(); assert.equal(hash(received), hash(expected));
    await viewer.page.waitForFunction(() => (window as unknown as TestWindow).seedTest.stats.p2pDownloaded > 0);
    if (kind === 'movie') {
      await viewer.page.evaluate(() => (window as unknown as TestWindow).HighpassBridge.playhead(130));
      let warmed = false; for (let attempt = 0; attempt < 100; attempt++) {
        const state = (await app.inject({ url: '/api/admin/seeds', headers: admin })).json<{ streams: { swarm: string; warmPositions: number[] }[] }>();
        if (state.streams.some((seed) => seed.swarm === viewer.playback.swarmId && seed.warmPositions.some((position) => Math.abs(position - 130) < 4))) { warmed = true; break; }
        await viewer.page.waitForTimeout(200);
      } assert.ok(warmed, 'Seed deve confirmar a preparação do seek antes do teste sem HTTP');
      // ExoPlayer refreshes an EVENT playlist while the origin keeps producing
      // segments. Publish that same fresh snapshot before seeking in this Core.
      const refreshed = await (await viewer.context.request.get(address + viewer.playback.url)).text();
      const far = refreshed.split('\n').find((line) => line.endsWith('chunk000032.ts')); assert.ok(far);
      await viewer.page.evaluate(({ text, uri }) => (window as unknown as TestWindow).HighpassBridge.playlist(uri, text), { text: refreshed, uri: address + viewer.playback.url });
      const seek = await load(viewer.page, 'seek-130', address + far); assert.equal(hash(seek), hash(await (await viewer.context.request.get(address + far)).body()));
    }
    console.log(`Seed → ${kind}: ${received.length} bytes P2P com HTTP bloqueado, SHA-256 idêntico`);
    await viewer.page.evaluate(() => (window as unknown as TestWindow).HighpassBridge.destroy()); await viewer.context.close();
  }
  const web = await browser.newContext();
  assert.equal((await web.request.post(address + '/api/iptv/login', { data: { username: 'alice', password: 'secret-line' } })).status(), 200);
  const warm = await (await web.request.post(address + '/api/iptv/playback', { data: { kind: 'movie', id: '2' } })).json() as Playback;
  assert.ok(warm.delivery); await web.request.post(address + warm.delivery.seedPath, { data: { position: 0 } }); await ready(warm.swarmId);
  const screen = await web.newPage(); const pageErrors: string[] = []; screen.on('pageerror', (error) => pageErrors.push(error.message));
  await screen.goto(address + '/player/'); await screen.getByRole('button', { name: '▣ Filmes', exact: true }).click();
  await blockMedia(screen); const firstFrameStarted = Date.now(); await screen.getByRole('button', { name: /Filme de Teste.*Filme/ }).click();
  await screen.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0, undefined, { timeout: 30000 });
  await screen.waitForFunction(() => Number(document.querySelector('[data-testid="p2p-percentage"]')?.textContent?.replace('%', '')) > 99);
  assert.equal(Number(await screen.getByTestId('http-percentage').textContent().then((text) => text?.replace('%', ''))), 0);
  await screen.locator('.traffic-overlay[data-mode="p2p"]').waitFor();
  console.log(`Primeiro frame de seed P2P aquecido em ${Date.now() - firstFrameStarted} ms; sem reiniciar HLS para alternar transporte`);
  console.log('WebPlayer HTML5 aprovado com único espectador: vídeo decodificado e 100% dos segmentos por P2P, HTTP bloqueado');
  await app.inject({ method: 'POST', url: `/api/admin/seeds/${warm.swarmId}/restart`, headers: admin }); await screen.unroute('**/api/iptv/**');
  await screen.locator('video').evaluate((video) => { (video as HTMLVideoElement).currentTime = 200; });
  await screen.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 201, undefined, { timeout: 30000 });
  await screen.waitForFunction(() => Number(document.querySelector('[data-testid="http-percentage"]')?.textContent?.replace('%', '')) > 0);
  await ready(warm.swarmId); await screen.waitForTimeout(6500); await blockMedia(screen);
  await screen.locator('video').evaluate((video) => { (video as HTMLVideoElement).currentTime = 360; });
  await screen.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 361, undefined, { timeout: 30000 });
  assert.deepEqual(pageErrors, []); console.log('WebPlayer recuperado no mesmo vídeo: interrupção do seed → HTTP em seek 200s → P2P em seek 360s com HTTP bloqueado');
  await web.close();
  const roku = await browser.newContext(); await roku.request.post(address + '/api/iptv/login', { data: { username: 'bob', password: 'secret-line' } });
  const descriptor = await (await roku.request.post(address + '/api/iptv/playback', { data: { kind: 'movie', id: '2', client: 'roku' } })).json() as Playback;
  const text = await (await roku.request.get(address + descriptor.url)).text(); const target = text.split('\n').find((line) => line.endsWith('chunk000000.ts')); assert.ok(target);
  const response = await roku.request.get(address + target); assert.equal(response.status(), 200); assert.ok((await response.body()).length > 0);
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  const traffic = await (await roku.request.get(address + descriptor.statsPath)).json() as { p2pDownloaded: number; scope: string }; assert.ok(traffic.p2pDownloaded > 0); assert.equal(traffic.scope, 'gateway-to-swarm');
  console.log(`Roku via gateway aprovado: ${traffic.p2pDownloaded} bytes WebRTC recebidos do seed`);
  const metrics = await app.inject({ url: '/metrics', headers: { authorization: 'Bearer local-metrics-token-change-before-production' } }); assert.match(metrics.body, /p2p_seed_uploaded_bytes_total [1-9]/);
} finally { await browser.close(); await app.close(); await source.close(); await rm(folder, { recursive: true, force: true }); }
