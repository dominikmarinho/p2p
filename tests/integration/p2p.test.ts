import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import Fastify from 'fastify';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) throw new Error('Use banco dedicado e NODE_ENV=test');
const source = Fastify();
source.get<{ Querystring: { username: string; password: string } }>('/player_api.php', (request, reply) => reply.send({ user_info: { auth: request.query.username === 'good' && request.query.password === 'correct' ? 1 : 0, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 3600) } }));
source.route({ method: ['GET', 'HEAD'], url: '/live/:username/:password/:stream', handler: (_request, reply) => reply.code(200).send() });
let app: ReturnType<typeof buildApp>;
let other: ReturnType<typeof buildApp>;
let url: string;
let otherUrl: string;
let sourceUrl: string;
let serverId: string;
let fallbackId: string;
let keyId: string;
const channel = `test-${randomUUID()}`;
const isolatedChannel = `test-${randomUUID()}`;
const bootstrap = 'local-admin-key-change-before-production';
const headers = { 'x-api-key': bootstrap };
const metricsHeaders = { authorization: 'Bearer local-metrics-token-change-before-production' };
const config = { bufferSeconds: 15, maxUploadKbps: 2048, maxConnectionsPerNode: 4, maxPeersPerChannel: 256 };
const sockets: WebSocket[] = [];

beforeAll(async () => {
  sourceUrl = await source.listen({ host: '127.0.0.1', port: 0 });
  const env = loadEnvironment({ ...process.env, XUI_ALLOW_HTTP: 'true', XUI_ALLOWED_HOSTS: `${new URL(sourceUrl).host},127.0.0.1:1`, RATE_LIMIT_MAX: '1000', RATE_LIMIT_NAMESPACE: `test:${randomUUID()}:` });
  app = buildApp(env); other = buildApp(env);
  url = await app.listen({ host: '127.0.0.1', port: 0 });
  otherUrl = await other.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  if (app !== undefined) {
    await app.inject({ method: 'DELETE', url: `/api/admin/routes/${channel}`, headers });
    await app.inject({ method: 'DELETE', url: `/api/admin/routes/${isolatedChannel}`, headers });
    if (serverId) await app.inject({ method: 'DELETE', url: `/api/admin/xui-servers/${serverId}`, headers });
    if (fallbackId) await app.inject({ method: 'DELETE', url: `/api/admin/xui-servers/${fallbackId}`, headers });
    if (keyId) await app.inject({ method: 'DELETE', url: `/api/admin/keys/${keyId}`, headers });
    await app.close();
  }
  if (other !== undefined) await other.close();
  await source.close();
});
async function ticket(target = app, password = 'correct') {
  const response = await target.inject({ method: 'POST', url: '/p2p/authorize', payload: { channel, username: 'good', password } });
  expect(response.statusCode).toBe(200);
  return response.json<{ ticket: string }>().ticket;
}
async function connect(address: string, value: string) {
  const socket = new WebSocket(`${address.replace('http:', 'ws:')}/p2p/ws?ticket=${value}`);
  sockets.push(socket);
  const welcome = once(socket, 'message');
  await once(socket, 'open');
  const [raw] = await welcome as [Buffer];
  return { socket, welcome: JSON.parse(raw.toString()) as { peerId: string; peers: string[] } };
}

describe('controle P2P e observabilidade', () => {
  it('serve painel e assets com API administrativa protegida', async () => {
    expect((await app.inject('/admin')).body).toContain('P2P CONTROL PLANE');
    expect((await app.inject('/admin/admin.js')).statusCode).toBe(200);
    expect((await app.inject('/api/admin/xui-servers')).statusCode).toBe(401);
  });
  it('cadastra XUI, cifra as credenciais administrativas e rejeita URLs fora da allowlist', async () => {
    const invalid = await app.inject({ method: 'POST', url: '/api/admin/xui-servers', headers, payload: { name: 'Invalid', baseUrl: 'http://169.254.169.254' } });
    expect(invalid.statusCode).toBe(400);
    const create = await app.inject({ method: 'POST', url: '/api/admin/xui-servers', headers, payload: { name: 'Test source', baseUrl: sourceUrl, adminAccessCode: 'admin-code', adminApiKey: 'secret-xui-token' } });
    expect(create.statusCode).toBe(201); serverId = create.json<{ id: string }>().id;
    const list = await app.inject({ url: '/api/admin/xui-servers', headers });
    expect(list.body).not.toContain('secret-xui-token'); expect(list.body).not.toContain('encryptedAdmin'); expect(list.body).not.toContain('admin-code');
    expect(list.json<{ hasAdminApiKey: boolean }[]>().some((server) => server.hasAdminApiKey)).toBe(true);
    expect((await app.inject({ method: 'PUT', url: `/api/admin/xui-servers/${serverId}`, headers, payload: { name: 'Updated', baseUrl: sourceUrl } })).statusCode).toBe(200);
  });
  it('gerencia regras e parâmetros e impede remover origem em uso', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/admin/config', headers, payload: config })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/routes', headers, payload: { channel, streamId: 1, serverId } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/xui-servers/${serverId}`, headers })).statusCode).toBe(409);
  });
  it('provisiona chaves administrativas, aplica whitelist e registra auditoria', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/admin/keys', headers, payload: { name: 'Test key' } })).json<{ id: string; secret: string }>();
    keyId = created.id;
    expect((await app.inject({ method: 'PUT', url: `/api/admin/keys/${keyId}`, headers, payload: { name: 'Renamed key' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/admin/config', headers: { 'x-api-key': created.secret } })).statusCode).toBe(200);
    const entries = (await app.inject({ method: 'POST', url: '/api/admin/whitelist', headers, payload: { cidr: '192.0.2.0/24' } })).json<{ id: string }[]>();
    expect((await app.inject({ method: 'PUT', url: `/api/admin/whitelist/${entries[0]?.id}`, headers, payload: { cidr: '192.0.2.0/25' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/admin/config', headers: { 'x-api-key': created.secret } })).statusCode).toBe(403);
    await app.inject({ method: 'DELETE', url: `/api/admin/whitelist/${entries[0]?.id}`, headers });
    const list = await app.inject({ url: '/api/admin/keys', headers }); expect(list.body).not.toContain(created.secret);
    const audit = await app.inject({ url: '/api/admin/audit', headers }); expect(audit.statusCode).toBe(200); expect(audit.body).not.toContain('secret-xui-token');
  });
  it('rejeita linha inválida e não concede acesso a canal desconhecido', async () => {
    expect((await app.inject({ method: 'POST', url: '/p2p/authorize', payload: { channel, username: 'good', password: 'wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/p2p/authorize', payload: { channel: 'unknown', username: 'good', password: 'correct' } })).statusCode).toBe(404);
  });
  it('encaminha offer/answer/ice entre processos via Redis sem transmitir credenciais', async () => {
    const firstTicket = await ticket();
    const first = await connect(url, firstTicket);
    const second = await connect(otherUrl, await ticket(other));
    expect(second.welcome.peers).toContain(first.welcome.peerId);
    const received = once(second.socket, 'message');
    first.socket.send(JSON.stringify({ type: 'signal', to: second.welcome.peerId, data: { kind: 'offer', payload: 'test-sdp' } }));
    const [raw] = await received as [Buffer];
    expect(JSON.parse(raw.toString())).toEqual({ type: 'signal', from: first.welcome.peerId, data: { kind: 'offer', payload: 'test-sdp' } });
    expect((await app.inject(`/p2p/ws?ticket=${firstTicket}`)).statusCode).toBe(401);
    const metrics = await app.inject({ url: '/metrics', headers: metricsHeaders });
    expect(metrics.body).toContain('websocket_active_connections 1');
    expect(metrics.body).toContain('websocket_messages_received_total 1');
    expect(metrics.body).toContain('http_request_duration_seconds_bucket');
    expect(metrics.body).not.toContain('secret-xui-token'); expect(metrics.body).not.toContain(channel);
    await Promise.all([first.socket, second.socket].map(async (socket) => { const closed = once(socket, 'close'); socket.close(); await closed; }));
  });
  it('isola métricas por instância e protege /metrics por Bearer', async () => {
    expect((await app.inject('/metrics')).statusCode).toBe(401);
    const metrics = await other.inject({ url: '/metrics', headers: metricsHeaders });
    expect(metrics.statusCode).toBe(200); expect(metrics.body).toContain('nodejs_heap_size_used_bytes'); expect(metrics.body).toContain('process_resident_memory_bytes');
    expect(metrics.headers['content-type']).toContain('text/plain');
  });
  it('usa fallback quando a origem principal está indisponível', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/admin/xui-servers', headers, payload: { name: 'Unavailable', baseUrl: 'http://127.0.0.1:1' } });
    fallbackId = bad.json<{ id: string }>().id;
    await app.inject({ method: 'PUT', url: '/api/admin/routes', headers, payload: { channel, streamId: 1, serverId: fallbackId, fallbackServerIds: [serverId] } });
    expect(await ticket()).toHaveLength(64);
    await app.inject({ method: 'PUT', url: '/api/admin/routes', headers, payload: { channel, streamId: 1, serverId } });
  });
  it('enforce limite de conexões da linha entre instâncias', async () => {
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers, payload: { ...config, maxConnectionsPerNode: 1 } });
    const first = await connect(url, await ticket());
    const second = new WebSocket(`${otherUrl.replace('http:', 'ws:')}/p2p/ws?ticket=${await ticket(other)}`);
    sockets.push(second); const closed = once(second, 'close');
    const args: unknown[] = await closed; expect(args[0]).toBe(1013);
    const firstClosed = once(first.socket, 'close'); first.socket.close(); await firstClosed;
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers, payload: config });
  });
  it('rejeita sinalização para um swarm diferente', async () => {
    await app.inject({ method: 'PUT', url: '/api/admin/routes', headers, payload: { channel: isolatedChannel, streamId: 1, serverId } });
    const first = await connect(url, await ticket());
    const response = await other.inject({ method: 'POST', url: '/p2p/authorize', payload: { channel: isolatedChannel, username: 'good', password: 'correct' } });
    expect(response.statusCode).toBe(200);
    const second = await connect(otherUrl, response.json<{ ticket: string }>().ticket);
    const closed = once(first.socket, 'close');
    first.socket.send(JSON.stringify({ type: 'signal', to: second.welcome.peerId, data: { kind: 'ice', payload: 'candidate' } }));
    const args: unknown[] = await closed; expect(args[0]).toBe(1008);
    const secondClosed = once(second.socket, 'close'); second.socket.close(); await secondClosed;
  });
});
