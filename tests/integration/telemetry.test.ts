import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { xuiFixture } from '../helpers/xui-fixture.js';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
const source = xuiFixture(); let app: ReturnType<typeof buildApp>; let headers: { authorization: string }; let path: string; let seed: string;
const admin = { 'x-api-key': 'local-admin-key-change-before-production' };
beforeAll(async () => {
  const origin = await source.listen({ host: '127.0.0.1', port: 0 }); app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', P2P_DELIVERY_ENABLED: 'true', RATE_LIMIT_MAX: '1000', RATE_LIMIT_NAMESPACE: `telemetry:${randomUUID()}:` })); await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'alice', password: 'secret-line' } }); headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  const descriptor = (await app.inject({ method: 'POST', url: '/api/iptv/playback', headers, payload: { kind: 'live', id: '1' } })).json<{ telemetryPath: string; delivery: { seedPath: string } }>(); path = descriptor.telemetryPath; seed = descriptor.delivery.seedPath;
});
afterAll(async () => { if (app !== undefined) await app.close(); await source.close(); });
it('deduplica contadores cumulativos dos players e rejeita propriedade de outra linha', async () => {
  const clientId = randomUUID(); const payload = { clientId, client: 'web', mode: 'p2p', http: 100, p2p: 200, upload: 50 };
  expect((await app.inject({ method: 'POST', url: path, headers, payload })).statusCode).toBe(204);
  expect((await app.inject({ method: 'POST', url: path, headers, payload })).statusCode).toBe(204);
  const metrics = await app.inject({ url: '/metrics', headers: { authorization: 'Bearer local-metrics-token-change-before-production' } });
  expect(metrics.body).toContain('player_reported_download_bytes_total{transport="p2p",client="web"} 200');
  const login = await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'bob', password: 'secret-line' } }); const other = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  expect((await app.inject({ method: 'POST', url: path, headers: other, payload })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: seed, headers: other, payload: { position: 0 } })).statusCode).toBe(401);
});
it('protege monitoramento e retorna indisponibilidade do seed sem quebrar HTTP', async () => {
  expect((await app.inject('/api/admin/monitoring')).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/admin/monitoring', headers: admin })).statusCode).toBe(200);
  const response = await app.inject({ method: 'POST', url: seed, headers, payload: { position: 0 } }); expect(response.json()).toEqual({ state: 'unavailable', reason: 'disabled' });
});
