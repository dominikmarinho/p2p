import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { loadEnvironment } from '../config/env.js';
const origin = Fastify();
origin.get<{ Querystring: { username: string; action?: string } }>('/player_api.php', (request) => {
  const name = request.query.username;
  if (request.query.action) return [];
  return { user_info: { auth: name === 'invalid' ? 0 : 1, username: name, status: name === 'disabled' ? 'Disabled' : 'Active', exp_date: String(Math.floor(Date.now() / 1000) + (name === 'expired' ? -60 : 3600)), max_connections: 1 } };
});
let app: ReturnType<typeof buildApp>;
beforeAll(async () => { const url = await origin.listen({ host: '127.0.0.1', port: 0 }); app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: url, XUI_ALLOW_HTTP: 'true', RATE_LIMIT_NAMESPACE: `xui-test:${randomUUID()}:` })); await app.ready(); });
afterAll(async () => { if (app !== undefined) await app.close(); await origin.close(); });
describe('contrato XUI ONE simulado', () => {
  it.each(['invalid', 'expired', 'disabled'])('recusa linha %s', async (username) => expect((await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username, password: 'mock-only-password' } })).statusCode).toBe(401));
  it('aceita conta ativa sem criar cadastro IPTV local', async () => { const response = await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'active', password: 'mock-only-password' } }); expect(response.statusCode).toBe(200); expect(response.body).not.toContain('mock-only-password'); });
});
