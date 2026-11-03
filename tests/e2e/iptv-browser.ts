import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { xuiFixture } from '../helpers/xui-fixture.js';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
import type { Playback } from '../../apps/webplayer/src/api.js';
import type { AndroidBridgeApi } from '../../apps/webplayer/src/p2p/android-bridge.js';
type BridgeWindow = Window & { HighpassBridge: AndroidBridgeApi };

const execFile = promisify(execFileCallback);
if (process.env.NODE_ENV !== 'test') throw new Error('NODE_ENV=test obrigatório');
const folder = await mkdtemp(join(tmpdir(), 'highpass-hls-'));
await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '20', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '48', '-sc_threshold', '0', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_segment_filename', join(folder, 'chunk%d.ts'), join(folder, 'index.m3u8')]);
await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(folder, 'index.m3u8'), '-c', 'copy', '-movflags', '+faststart', join(folder, 'movie.mp4')]);
const source = xuiFixture(folder);
const origin = await source.listen({ host: '127.0.0.1', port: 0 });
const app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', RATE_LIMIT_MAX: '10000', RATE_LIMIT_NAMESPACE: `browser:${randomUUID()}:`, RTC_ICE_SERVERS: '[]' }));
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage(); const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(address + '/player/');
  await page.getByLabel('Usuário', { exact: true }).waitFor();
  assert.equal(await page.locator('input').count(), 2);
  await mkdir('docs/previews', { recursive: true });
  await page.screenshot({ path: 'docs/previews/webplayer-login.png', fullPage: true });
  await page.getByLabel('Usuário', { exact: true }).fill('alice'); await page.getByLabel('Senha', { exact: true }).fill('secret-line');
  await page.getByRole('button', { name: 'Entrar e assistir →' }).click();
  await page.getByRole('button', { name: /Highpass Teste Ao Vivo/ }).waitFor();
  const segments: { url: string; bytes: Buffer }[] = [];
  page.on('response', (response) => { if ((response.headers()['content-type'] ?? '').includes('video/mp2t')) void response.body().catch(async () => (await context.request.get(response.url())).body()).then((bytes) => segments.push({ url: response.url(), bytes })).catch(() => undefined); });
  await page.getByRole('button', { name: /Highpass Teste Ao Vivo/ }).click();
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video !== null && video.readyState >= 2 && video.currentTime > 0; }, { timeout: 30000 });
  for (let attempt = 0; attempt < 50 && !segments.length; attempt++) await page.waitForTimeout(100);
  assert.ok(segments.length > 0, 'Vídeo deve ter recebido segmentos HTTP reais');

  // A segunda página executa exatamente a ponte distribuída ao WebView Android.
  const nativeContext = await browser.newContext(); const native = await nativeContext.newPage();
  await native.addInitScript(() => {
    const state = { ready: false, activeId: 'warm', stats: { p2pDownloaded: 0, peers: 0 }, chunks: [] as string[], done: false, fallback: false };
    Object.assign(window, { testNative: state, NativeSegments: {
      ready() { state.ready = true; }, stats(raw: string) { state.stats = JSON.parse(raw) as typeof state.stats; },
      complete(id: string, chunk: string, done: boolean) { if (id === state.activeId) { state.chunks.push(chunk); state.done = done; } }, fallback(id: string) { if (id === state.activeId) state.fallback = true; },
    } });
  });
  const login = await nativeContext.request.post(address + '/api/iptv/login', { data: { username: 'bob', password: 'secret-line' } }); assert.equal(login.status(), 200);
  const play = await nativeContext.request.post(address + '/api/iptv/playback', { data: { kind: 'live', id: '1' } }); assert.equal(play.status(), 200);
  const descriptor = await play.json() as Playback;
  await native.goto(address + '/player/android-bridge.html');
  await native.waitForFunction(() => (window as unknown as { testNative: { ready: boolean } }).testNative.ready);
  const manifestResponse = await nativeContext.request.get(address + descriptor.url); const manifest = await manifestResponse.text();
  const urls = manifest.split('\n').filter((line) => line.startsWith('/api/iptv/media/'));
  const upstreamSegments = await Promise.all(urls.map((_url, index) => readFile(join(folder, `chunk${index}.ts`))));
  const received = segments.at(-1); assert.ok(received);
  const targetIndex = upstreamSegments.findIndex((bytes) => bytes.equals(received.bytes)); assert.ok(targetIndex >= 0, 'Segmento HTTP corresponde ao vídeo de teste');
  const target = urls[targetIndex]; assert.ok(target);
  await native.evaluate(({ playback, playlist, manifestUrl }) => { (window as BridgeWindow).HighpassBridge.init(playback, true); (window as BridgeWindow).HighpassBridge.playlist(manifestUrl, playlist); }, { playback: descriptor, playlist: manifest, manifestUrl: address + descriptor.url });
  await native.route('**/api/iptv/media/**', async (route) => { await new Promise<void>((resolve) => setTimeout(resolve, 1500)); await route.abort(); });
  await native.evaluate((url) => (window as BridgeWindow).HighpassBridge.load('warm', url, 0, -1), address + urls[0]);
  await native.waitForFunction(() => { const state = (window as unknown as { testNative: { stats: { p2pDownloaded: number } } }).testNative; return state.stats.p2pDownloaded > 0; }, undefined, { timeout: 35000 });
  await native.evaluate((url) => { const state = (window as unknown as { testNative: { activeId: string; done: boolean; fallback: boolean; chunks: string[] } }).testNative; state.activeId = 'target'; state.done = false; state.fallback = false; state.chunks = []; (window as BridgeWindow).HighpassBridge.load('target', url, 0, -1); }, address + target);
  await native.waitForFunction(() => (window as unknown as { testNative: { done: boolean } }).testNative.done, undefined, { timeout: 20000 });
  const result = await native.evaluate(() => (window as unknown as { testNative: { stats: { p2pDownloaded: number; peers: number }; chunks: string[] } }).testNative);
  const assembled = Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk, 'base64')));
  assert.equal(createHash('sha256').update(assembled).digest('hex'), createHash('sha256').update(received.bytes).digest('hex'));
  assert.ok(result.stats.p2pDownloaded >= assembled.length);
  console.log(`P2P real aprovado: ${assembled.length} bytes Web → ponte Android, HTTP bloqueado, SHA-256 idêntico; ${result.stats.peers} peer(s)`);
  await nativeContext.close();

  await page.getByLabel('Alternar favorito').click();
  await page.getByRole('button', { name: '♡ Favoritos', exact: true }).click();
  await page.getByRole('heading', { name: 'Highpass Teste Ao Vivo' }).first().waitFor();
  await page.getByRole('button', { name: '▣ Filmes', exact: true }).click(); await page.getByRole('heading', { name: 'Filme de Teste' }).waitFor();
  await page.getByRole('button', { name: '▤ Séries', exact: true }).click(); await page.getByRole('heading', { name: 'Série de Teste' }).waitFor();
  await page.getByRole('button', { name: /Série de Teste.*Série/ }).click(); await page.getByRole('button', { name: /Primeiro episódio/ }).waitFor();
  await page.getByRole('button', { name: '◉ Canais ao vivo', exact: true }).click();
  await page.getByRole('button', { name: /Highpass Teste Ao Vivo/ }).click();
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await page.screenshot({ path: 'docs/previews/webplayer-live.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'docs/previews/webplayer-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '◌ Minha conta', exact: true }).click(); await page.getByRole('button', { name: 'Encerrar sessão' }).click();
  await page.getByLabel('Usuário', { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log('WebPlayer aprovado: login com dois campos, vídeo HLS, EPG, favoritos, filmes, séries, episódios, logout e layout móvel');
} finally { await browser.close(); await app.close(); await source.close(); await rm(folder, { recursive: true, force: true }); }
