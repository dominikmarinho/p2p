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
if (process.env.NODE_ENV !== 'test') throw new Error('NODE_ENV=test obrigatório');
const folder = await mkdtemp(join(tmpdir(), 'highpass-isolated-'));
const execFile = promisify(execCallback);
await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '48', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '24', '-movflags', '+faststart', join(folder, 'movie.mp4')]);
await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(folder, 'movie.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '8', '-hls_segment_filename', join(folder, 'chunk%d.ts'), join(folder, 'index.m3u8')]);
const source = xuiFixture(folder); const origin = await source.listen({ host: '127.0.0.1', port: 0 });
const app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', P2P_DELIVERY_ENABLED: 'true', P2P_SEED_ENABLED: 'true', RTC_ICE_SERVERS: '[]', VOD_CACHE_DIR: folder, RATE_LIMIT_MAX: '10000', RATE_LIMIT_NAMESPACE: `isolated:${randomUUID()}:` }));
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext(); await context.request.post(address + '/api/iptv/login', { data: { username: 'alice', password: 'secret-line' } });
  const page = await context.newPage(); await page.goto(address + '/player/http/'); await page.getByRole('button', { name: /Highpass Teste Ao Vivo/ }).click();
  await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0);
  const admin = { 'x-api-key': 'local-admin-key-change-before-production' };
  const snapshots = async () => (await app.inject({ url: '/api/admin/playback-diagnostics', headers: admin })).json<{ code: string; frame?: string; frameStatus: string; frames: number; history?: { attempt: string }[]; startup?: { attempt: string; error?: string; traffic?: { httpBytes: number; p2pBytes: number; uploadBytes: number }; firstSegment?: { bytes: number; durationSeconds: number; loadMs: number }; marks: { authorization?: number; firstFrame?: number } } }[]>();
  assert.equal((await snapshots()).length, 0, 'Nenhuma captura antes da ativação explícita');
  await page.getByRole('button', { name: 'Compartilhar diagnóstico e imagens' }).click();
  await page.getByText(/Compartilhando diagnóstico e imagens|Diagnóstico recebido/).waitFor();
  let sample; for (let i = 0; i < 60; i++) { sample = (await snapshots())[0]; if (sample?.frame) break; await page.waitForTimeout(200); }
  assert.ok(sample?.frame?.startsWith('data:image/jpeg;base64,/9j/')); assert.equal(sample?.frameStatus, 'captured'); assert.ok(sample.frames > 0);
  let rejectedImage = false;
  await page.route('**/api/iptv/diagnostics/*/*', async (route) => {
    if (route.request().method() === 'POST' && (route.request().postDataJSON() as { frame?: string } | null)?.frame && !rejectedImage) { rejectedImage = true; await route.fulfill({ status: 413, body: 'Proxy body limit' }); }
    else await route.continue();
  });
  await page.getByText(/imagem bloqueada pelo proxy; enviando dados/).waitFor({ timeout: 15000 });
  assert.ok(rejectedImage); assert.equal((await snapshots())[0]?.frameStatus, 'blocked');
  let transient = false;
  await page.route('**/api/iptv/diagnostics/*/*', async (route) => {
    if (route.request().method() === 'POST' && !transient) { transient = true; await route.fulfill({ status: 503, body: 'Temporary proxy failure' }); }
    else await route.continue();
  });
  await page.getByText(/Envio interrompido/).waitFor({ timeout: 10000 });
  await page.getByText(/Diagnóstico recebido/).waitFor({ timeout: 15000 }); assert.ok(transient);
  await page.getByRole('button', { name: 'Parar compartilhamento' }).click();
  for (let i = 0; i < 30 && (await snapshots()).length > 0; i++) await page.waitForTimeout(100);
  assert.equal((await snapshots()).length, 0); await page.waitForTimeout(5500); assert.equal((await snapshots()).length, 0, 'Amostra não pode reaparecer após parar');
  await page.getByRole('button', { name: 'Compartilhar diagnóstico e imagens' }).click(); await page.getByText(/Compartilhando diagnóstico e imagens|Diagnóstico recebido/).waitFor();
  await page.goto('about:blank'); for (let i = 0; i < 30 && (await snapshots()).length > 0; i++) await page.waitForTimeout(100);
  assert.equal((await snapshots()).length, 0);
  await page.goto(address + '/player/http/');
  await page.getByRole('button', { name: 'Compartilhar diagnóstico de abertura', exact: true }).click();
  await page.getByText(/pronto: clique em um canal/).waitFor();
  let pending; for (let i = 0; i < 30; i++) { pending = (await snapshots())[0]; if (pending) break; await page.waitForTimeout(100); }
  assert.ok(pending); assert.equal(pending.frameStatus, 'disabled'); assert.equal(pending.frame, undefined);
  const startupCode = pending.code;
  await page.route('**/api/iptv/playback', async (route) => { await page.waitForTimeout(1000); await route.continue(); });
  await page.getByRole('button', { name: /Highpass Teste Ao Vivo/ }).click();
  let opened; for (let i = 0; i < 100; i++) { opened = (await snapshots()).find((row) => row.code === startupCode); if (opened?.startup?.marks.firstFrame !== undefined) break; await page.waitForTimeout(200); }
  assert.ok(opened?.startup?.marks.firstFrame !== undefined); assert.ok(opened.startup.marks.firstFrame >= 1000); assert.ok((opened.startup.marks.authorization ?? 0) >= 900); assert.equal(opened.frame, undefined); assert.ok((opened.startup.firstSegment?.bytes ?? 0) > 0); assert.ok((opened.startup.traffic?.httpBytes ?? 0) > 0); assert.equal(opened.startup.traffic?.p2pBytes, 0);
  const attempt = opened.startup.attempt;
  await page.route('**/api/iptv/playback', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Temporary test failure"}' }));
  await page.getByRole('button', { name: /Highpass Teste Ao Vivo/ }).click();
  let failed; for (let i = 0; i < 60; i++) { failed = (await snapshots()).find((row) => row.code === startupCode); if (failed?.startup?.error) break; await page.waitForTimeout(200); }
  assert.equal(failed?.startup?.error, 'authorizationFailed'); assert.notEqual(failed?.startup?.attempt, attempt); assert.ok(failed?.history?.some((row) => row.attempt === attempt), 'A troca anterior permanece no histórico da sessão'); assert.equal(failed?.startup?.marks.firstFrame, undefined);
  await page.getByRole('button', { name: 'Parar análise de abertura', exact: true }).click();
  for (let i = 0; i < 30 && (await snapshots()).some((row) => row.code === startupCode); i++) await page.waitForTimeout(100);
  assert.equal((await snapshots()).some((row) => row.code === startupCode), false); await context.close();
  console.log('Abertura aprovada: consentimento antes do clique, autorização atrasada medida, primeiro frame real, mesma sessão entre seleções e erro antes do vídeo visível');
  console.log('Diagnóstico visual aprovado: opt-in, JPEG real de vídeo decodificado, métricas, parada e limpeza ao sair da aba');
} finally { await browser.close(); await app.close(); await source.close(); await rm(folder, { recursive: true, force: true }); }
