import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
import { xuiFixture } from '../helpers/xui-fixture.js';
import type { Playback } from '../../apps/webplayer/src/api.js';
import type { AndroidBridgeApi } from '../../apps/webplayer/src/p2p/android-bridge.js';

if (process.env.NODE_ENV !== 'test') throw new Error('Serviços exclusivos de teste obrigatórios');
const source = xuiFixture(); let originRequests = 0;
source.addHook('onRequest', (request, _reply, done) => { if (request.url.startsWith('/live/') || request.url.startsWith('/hls/')) originRequests++; done(); });
const origin = await source.listen({ host: '127.0.0.1', port: 0 });
const app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', P2P_SEED_ENABLED: 'true', P2P_DELIVERY_ENABLED: 'true', RATE_LIMIT_MAX: '10000', RATE_LIMIT_NAMESPACE: `seed-close:${randomUUID()}:`, RTC_ICE_SERVERS: '[]' }));
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const context = await browser.newContext(); const admin = { 'x-api-key': 'local-admin-key-change-before-production' };
const snapshot = async () => (await app.inject({ url: '/api/admin/seeds', headers: admin })).json<{ active: number; ready: number; streams: { viewers: number }[] }>();
async function until(predicate: () => Promise<boolean>, description: string) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await new Promise<void>((resolve) => setTimeout(resolve, 100)); }
  throw new Error(description);
}
async function play(): Promise<Playback> {
  const response = await context.request.post(address + '/api/iptv/playback', { data: { kind: 'live', id: '1' } }); assert.equal(response.status(), 200); return response.json() as Promise<Playback>;
}
async function release(value: Playback) { assert.ok(value.delivery); assert.equal((await context.request.delete(address + value.delivery.seedPath)).status(), 204); }
try {
  assert.equal((await context.request.post(address + '/api/iptv/login', { data: { username: 'alice', password: 'secret-line' } })).status(), 200);
  const starting = await play(); await release(starting);
  await until(async () => (await snapshot()).active === 0, 'Seed que ainda iniciava não foi removido');
  await new Promise<void>((resolve) => setTimeout(resolve, 1500)); const afterPendingClose = originRequests;
  await new Promise<void>((resolve) => setTimeout(resolve, 1500)); assert.equal(originRequests, afterPendingClose, 'Worker cancelado não pode reaparecer e consultar a origem');

  const first = await play(); const second = await play(); assert.ok(first.delivery && second.delivery);
  await context.request.post(address + first.delivery.seedPath, { data: { position: 0 } });
  await context.request.post(address + second.delivery.seedPath, { data: { position: 0 } });
  await until(async () => (await snapshot()).ready === 1, 'Seed compartilhado não aqueceu');
  await release(first); assert.equal((await snapshot()).streams[0]?.viewers, 1, 'Sair de um player deve preservar o outro');
  await release(second); assert.equal((await snapshot()).active, 0);
  const afterLastClose = originRequests; await new Promise<void>((resolve) => setTimeout(resolve, 2500)); assert.equal(originRequests, afterLastClose, 'Último player saiu: nenhuma nova busca à origem');

  const page = await context.newPage(); await page.goto(address + '/player/android-bridge.html');
  await page.waitForFunction(() => typeof window.HighpassBridge !== 'undefined'); const tab = await play(); assert.ok(tab.delivery);
  await page.evaluate((value) => (window as Window & { HighpassBridge: AndroidBridgeApi }).HighpassBridge.init(value, true), tab);
  await until(async () => (await snapshot()).ready === 1, 'Lease da página não ativou o seed');
  await page.goto('about:blank'); await until(async () => (await snapshot()).active === 0, 'pagehide sem cleanup React deve liberar o seed');
  const afterNavigation = originRequests; await new Promise<void>((resolve) => setTimeout(resolve, 2500)); assert.equal(originRequests, afterNavigation);
  console.log('Lifecycle de seed aprovado: início cancelado sem worker órfão, dois players compartilham seed, último DELETE encerra HTTP e pagehide libera sem cleanup React');
} finally { await context.close(); await browser.close(); await app.close(); await source.close(); }
