import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
import { encrypt } from '../../src/lib/secrets.js';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) throw new Error('Use banco dedicado e NODE_ENV=test');
const source = Fastify();
const accessCode = 'control-code';
const apiKey = 'xui-key+with/slash?and&symbols=encoded';
let mode: 'success' | 'raw-list' | 'error-list' | 'failure' | 'html' | 'large' | 'redirect' = 'success';
let redirected = 0;
let lastAdmin: { action?: string; api_key?: string; authorization?: string } = {};
let playerCalls = 0;
source.get<{ Querystring: { action?: string; api_key?: string } }>('/control-code/', (request, reply) => {
  lastAdmin = { ...request.query, ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) };
  if (mode === 'redirect') return reply.redirect('/redirect-target');
  if (mode === 'html') return reply.type('text/html').send('<h1>Not Admin API</h1>');
  if (mode === 'large') return reply.send({ status: 'STATUS_SUCCESS', data: ['x'.repeat(1024 * 1024)] });
  if (mode === 'failure' || request.query.api_key !== apiKey || request.query.action !== 'get_servers') return reply.send({ status: 'STATUS_FAILURE', error: `Invalid API key ${request.query.api_key}` });
  if (mode === 'raw-list') return [{ id: '1', server_name: 'Fixture', private_data: apiKey }];
  if (mode === 'error-list') return [{ id: '1', error: `Invalid API key ${request.query.api_key}` }];
  return reply.type('text/html').send(JSON.stringify({ status: 'STATUS_SUCCESS', data: { '1': { id: 1, server_name: 'Fixture', secret_not_for_client: apiKey } } }));
});
source.get('/redirect-target', () => { redirected++; return { status: 'STATUS_SUCCESS', data: [] }; });
source.get<{ Querystring: Record<string, string> }>('/player_api.php', (request, reply) => {
  playerCalls++;
  if (request.headers.authorization || request.query.api_key) return reply.code(403).send();
  return { user_info: { auth: request.query.username === 'good' && request.query.password === 'correct' ? 1 : 0, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 3600) } };
});
source.route({ method: ['GET', 'HEAD'], url: '/live/:username/:password/:stream', handler: (request, reply) => reply.code(request.headers.authorization || request.url.includes('api_key=') ? 403 : 200).send() });
let app: ReturnType<typeof buildApp>;
let inspection: Pool;
let baseUrl = '';
let serverId = '';
let encryptionKey = '';
const channel = `xui-${randomUUID()}`;
const headers = { 'x-api-key': 'local-admin-key-change-before-production' };
const saved = () => ({ name: 'XUI Admin fixture', baseUrl, adminAccessCode: accessCode, adminApiKey: apiKey });
const check = () => app.inject({ method: 'POST', url: `/api/admin/xui-servers/${serverId}/test`, headers });
beforeAll(async () => {
  baseUrl = await source.listen({ host: '127.0.0.1', port: 0 });
  const env = loadEnvironment({ ...process.env, XUI_ALLOW_HTTP: 'true', XUI_ALLOWED_HOSTS: new URL(baseUrl).host, RATE_LIMIT_MAX: '1000', RATE_LIMIT_NAMESPACE: `xui-admin:${randomUUID()}:` });
  encryptionKey = env.CONFIG_ENCRYPTION_KEY;
  app = buildApp(env); await app.ready();
  inspection = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
});
afterAll(async () => {
  if (app !== undefined) {
    await app.inject({ method: 'DELETE', url: `/api/admin/routes/${channel}`, headers });
    if (serverId) await app.inject({ method: 'DELETE', url: `/api/admin/xui-servers/${serverId}`, headers });
    await app.close();
  }
  if (inspection) await inspection.end();
  await source.close();
});
describe('credenciais e Admin API XUI ONE', () => {
  it('separa Access Code e API Key e mantém ambos cifrados/ocultos', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/xui-servers', headers, payload: saved() });
    expect(created.statusCode).toBe(201); serverId = created.json<{ id: string }>().id;
    const list = await app.inject({ url: '/api/admin/xui-servers', headers });
    expect(list.body).not.toContain(accessCode); expect(list.body).not.toContain(apiKey); expect(list.body).not.toContain('encrypted');
    expect(list.json<{ id: string; hasAdminAccessCode: boolean; hasAdminApiKey: boolean }[]>().find(row => row.id === serverId)).toMatchObject({ hasAdminAccessCode: true, hasAdminApiKey: true });
    const { rows } = await inspection.query<{ encrypted_admin_access_code: string; encrypted_admin_api_key: string }>('select encrypted_admin_access_code, encrypted_admin_api_key from xui_servers where id=$1', [serverId]);
    expect(rows[0]?.encrypted_admin_access_code).toBeTruthy(); expect(rows[0]?.encrypted_admin_access_code).not.toContain(accessCode);
    expect(rows[0]?.encrypted_admin_api_key).toBeTruthy(); expect(rows[0]?.encrypted_admin_api_key).not.toContain(apiKey);
  });
  it('protege o teste e consulta somente get_servers com código no path e api_key na query', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/admin/xui-servers/${serverId}/test` })).statusCode).toBe(401);
    const result = await check(); expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ ok: true, action: 'get_servers', serverCount: 1 });
    expect(lastAdmin).toEqual({ action: 'get_servers', api_key: apiKey });
    expect(result.body).not.toContain(apiKey); expect(result.body).not.toContain('secret_not_for_client');
  });
  it('mantém as credenciais ao editar somente os dados públicos', async () => {
    expect((await app.inject({ method: 'PUT', url: `/api/admin/xui-servers/${serverId}`, headers, payload: { name: 'Renamed', baseUrl } })).statusCode).toBe(200);
    expect((await check()).statusCode).toBe(200);
  });
  it('aceita a lista direta com IDs string retornada pela origem real', async () => {
    mode = 'raw-list';
    try { const result = await check(); expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ ok: true, serverCount: 1 }); expect(result.body).not.toContain(apiKey); expect(result.body).not.toContain('private_data'); } finally { mode = 'success'; }
  });
  it('rejeita listas de erro sem confundir com servidores autenticados', async () => {
    mode = 'error-list';
    try { const result = await check(); expect(result.statusCode).toBe(502); expect(result.body).not.toContain(apiKey); expect(result.body).not.toContain('Invalid API key'); } finally { mode = 'success'; }
  });
  it('rejeita código com path traversal e o campo antigo apiToken', async () => {
    for (const input of [{ ...saved(), adminAccessCode: '../control-code' }, { ...saved(), apiToken: 'old-bearer' }]) expect((await app.inject({ method: 'PUT', url: `/api/admin/xui-servers/${serverId}`, headers, payload: input })).statusCode).toBe(400);
  });
  it('não expõe mensagens da origem quando a API Key é recusada', async () => {
    mode = 'failure';
    try { const result = await check(); expect(result.statusCode).toBe(502); expect(result.json()).toMatchObject({ code: 'XUI_ADMIN_CONNECTION' }); expect(result.body).not.toContain(apiKey); expect(result.body).not.toContain('Invalid API key'); } finally { mode = 'success'; }
  });
  it('rejeita HTML, respostas grandes e redirects sem seguir a URL remota', async () => {
    try { for (const variant of ['html', 'large', 'redirect'] as const) { mode = variant; expect((await check()).statusCode).toBe(502); } expect(redirected).toBe(0); } finally { mode = 'success'; }
  });
  it('valida a linha pela Player API sem transmitir segredos administrativos ou Bearer legado', async () => {
    await inspection.query('update xui_servers set encrypted_api_token=$1 where id=$2', [encrypt('legacy-must-not-leak', encryptionKey), serverId]);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/routes', headers, payload: { channel, streamId: 1, serverId } })).statusCode).toBe(200);
    const result = await app.inject({ method: 'POST', url: '/p2p/authorize', payload: { channel, username: 'good', password: 'correct' } });
    expect(result.statusCode).toBe(200); expect(playerCalls).toBe(1); expect(result.body).not.toContain(apiKey);
  });
  it('remove explicitamente as credenciais e informa o que falta para conectar', async () => {
    expect((await app.inject({ method: 'PUT', url: `/api/admin/xui-servers/${serverId}`, headers, payload: { name: 'Cleared', baseUrl, adminAccessCode: '', adminApiKey: '' } })).statusCode).toBe(200);
    const result = await check(); expect(result.statusCode).toBe(400); expect(result.json()).toMatchObject({ code: 'XUI_ADMIN_CREDENTIALS_REQUIRED' });
    const list = await app.inject({ url: '/api/admin/xui-servers', headers });
    expect(list.json<{ id: string }[]>().find(row => row.id === serverId)).toMatchObject({ hasAdminAccessCode: false, hasAdminApiKey: false, hasLegacyApiToken: false });
  });
});
