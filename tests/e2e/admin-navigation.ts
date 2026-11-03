import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { adminUi } from '../../src/modules/admin/ui.js';

const app = Fastify(); await adminUi(app);
app.get('/health/ready', () => ({ status: 'ok' }));
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
interface HeldResponse { release: () => void; started: Promise<void>; gate: Promise<void>; status: number; body: unknown; arrived: () => void }
const pending = new Map<string, HeldResponse[]>(); const held: HeldResponse[] = [];
function delay(path: string, body: unknown, status = 200): HeldResponse {
  let release: () => void = () => undefined; let arrived: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { arrived = resolve; });
  const response = { release, arrived, started, gate, status, body }; held.push(response);
  const queue = pending.get(path) ?? []; queue.push(response); pending.set(path, queue); return response;
}
const seed = { swarm: 'a'.repeat(64), kind: 'live', content: '31', viewers: 1, ready: true, originBytes: 1048576, p2pUploaded: 524288 };
const active = { enabled: true, active: 1, ready: 1, streams: [seed] };
const states: Record<string, unknown> = {
  me: { username: 'admin', mustChangePassword: false }, peers: { connections: 1 },
  'xui-servers': [{ id: 'xui-1', name: 'Origem autorizada', baseUrl: 'https://xui.example', enabled: true }],
  routes: [], audit: [], seeds: active,
};
try {
  const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/admin/', ''); const response = pending.get(path)?.shift();
    if (response) { response.arrived(); await response.gate; await route.fulfill({ status: response.status, json: response.body }); }
    else await route.fulfill({ status: 200, json: states[path] ?? {} });
  });
  const initial = await page.goto(address + '/admin'); assert.equal(initial?.headers()['cache-control'], 'no-store');
  assert.match(await page.locator('script[src]').getAttribute('src') ?? '', /admin\.js\?v=[a-f0-9]{16}$/);
  await page.getByText('Servidores cadastrados', { exact: true }).waitFor();

  const oldServer = delay('xui-servers', states['xui-servers']);
  await page.getByRole('button', { name: 'Servidores XUI ONE', exact: true }).click(); await oldServer.started;
  assert.equal(await page.locator('#content').getAttribute('inert'), '');
  await page.getByRole('button', { name: 'Seeds de mídia', exact: true }).click(); await page.getByRole('button', { name: 'Reiniciar seed' }).waitFor();
  oldServer.release(); await page.waitForTimeout(100);
  assert.equal(await page.getByRole('button', { name: '+ Adicionar', exact: true }).count(), 0);
  assert.equal(await page.locator('#notice').textContent(), '');
  assert.equal(await page.locator('#content table').count(), 1);
  assert.ok(await page.getByRole('button', { name: 'Seeds de mídia', exact: true }).evaluate((button) => button.classList.contains('active')));

  const staleSeed = delay('seeds', { enabled: true, active: 0, ready: 0, streams: [] });
  await page.getByRole('button', { name: 'Seeds de mídia', exact: true }).click(); await staleSeed.started;
  await page.getByRole('button', { name: 'Roteamento de canais', exact: true }).click(); await page.getByText('0 registros', { exact: true }).waitFor();
  staleSeed.release(); await page.waitForTimeout(100);
  assert.equal(await page.getByRole('heading', { name: 'Distribuição P2P com seed automático' }).count(), 0);
  assert.equal(await page.locator('#title').textContent(), 'Roteamento de canais');

  const staleFailure = delay('seeds', { message: 'Resposta antiga descartada' }, 500);
  await page.getByRole('button', { name: 'Seeds de mídia', exact: true }).click(); await staleFailure.started;
  await page.getByRole('button', { name: 'Seeds de mídia', exact: true }).click(); await page.getByRole('button', { name: 'Reiniciar seed' }).waitFor();
  staleFailure.release(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#notice').textContent(), '');
  assert.equal(await page.getByRole('button', { name: 'Reiniciar seed' }).count(), 1);

  const badPayload = delay('seeds', { enabled: true });
  await page.getByRole('button', { name: 'Seeds de mídia', exact: true }).click(); await badPayload.started; badPayload.release();
  await page.getByText('Resposta de seeds incompatível. Recarregue o painel para tentar novamente.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '+ Adicionar', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Reiniciar seed' }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('Painel administrativo aprovado: navegação concorrente, resposta antiga e falha antiga descartadas, payload inválido tratado e assets versionados sem cache');
} finally { for (const response of held) response.release(); await browser.close(); await app.close(); }
