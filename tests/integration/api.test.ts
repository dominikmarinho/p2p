import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) throw new Error('Use banco dedicado e NODE_ENV=test');
const app = buildApp(loadEnvironment({ ...process.env, RATE_LIMIT_MAX: '1000', RATE_LIMIT_NAMESPACE: `highpass:test:${randomUUID()}:`, LOG_LEVEL: 'silent' }));
type Pair = { accessToken: string; refreshToken: string };
let pair: Pair;
let address: string;
const credentials = { email: `test-${randomUUID()}@example.com`, password: 'a-long-secure-password-2026' };
const authorization = () => ({ authorization: `Bearer ${pair.accessToken}` });
const request = app.inject.bind(app);

beforeAll(async () => { address = await app.listen({ host: '127.0.0.1', port: 0 }); });
afterAll(async () => { await app.close(); });

describe('API com PostgreSQL e Redis reais', () => {
  it('informa liveness e readiness', async () => {
    expect((await request({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await request({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
  });
  it('registra, rejeita duplicidade, autentica e oculta o hash', async () => {
    const created = await request({ method: 'POST', url: '/auth/register', payload: credentials });
    expect(created.statusCode).toBe(201);
    expect(Object.keys(created.json<Record<string, unknown>>())).toEqual(['id']);
    expect((await request({ method: 'POST', url: '/auth/register', payload: credentials })).statusCode).toBe(409);
    const login = await request({ method: 'POST', url: '/auth/login', payload: credentials });
    expect(login.statusCode).toBe(200);
    pair = login.json<Pair>();
    expect(login.headers['cache-control']).toBe('no-store');
    expect((await request({ method: 'POST', url: '/auth/login', payload: { ...credentials, password: 'incorrect-password-123' } })).statusCode).toBe(401);
  });
  it('aplica autenticação e validação Zod', async () => {
    expect((await request({ method: 'GET', url: '/notes' })).statusCode).toBe(401);
    expect((await request({ method: 'POST', url: '/notes', headers: authorization(), payload: { title: '' } })).statusCode).toBe(400);
    expect((await request({ method: 'GET', url: '/notes/not-a-uuid', headers: authorization() })).statusCode).toBe(400);
    expect((await request({ method: 'POST', url: '/notes', headers: authorization(), payload: { title: 'a', content: 'x'.repeat(20000) } })).statusCode).toBe(413);
  });
  it('executa CRUD, paginação e isolamento entre usuários', async () => {
    const create = await request({ method: 'POST', url: '/notes', headers: authorization(), payload: { title: 'Primeira', content: 'Olá' } });
    expect(create.statusCode).toBe(201);
    const note = create.json<{ id: string }>();
    expect((await request({ method: 'GET', url: `/notes/${note.id}`, headers: authorization() })).statusCode).toBe(200);
    const stranger = app.jwt.sign({ sub: randomUUID(), type: 'access' });
    expect((await request({ method: 'GET', url: `/notes/${note.id}`, headers: { authorization: `Bearer ${stranger}` } })).statusCode).toBe(404);
    expect((await request({ method: 'PATCH', url: `/notes/${note.id}`, headers: { authorization: `Bearer ${stranger}` }, payload: { title: 'Ataque' } })).statusCode).toBe(404);
    expect((await request({ method: 'PATCH', url: `/notes/${note.id}`, headers: authorization(), payload: { title: 'Editada' } })).json<{ title: string }>().title).toBe('Editada');
    await request({ method: 'POST', url: '/notes', headers: authorization(), payload: { title: 'Segunda', content: '' } });
    const page = (await request({ method: 'GET', url: '/notes?limit=1', headers: authorization() })).json<{ items: unknown[]; nextCursor: string }>();
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTypeOf('string');
    const next = (await request({ method: 'GET', url: `/notes?limit=1&cursor=${page.nextCursor}`, headers: authorization() })).json<{ items: unknown[] }>();
    expect(next.items).toHaveLength(1);
    expect((await request({ method: 'DELETE', url: `/notes/${note.id}`, headers: authorization() })).statusCode).toBe(204);
    expect((await request({ method: 'GET', url: `/notes/${note.id}`, headers: authorization() })).statusCode).toBe(404);
  });
  it('consome ticket WS uma única vez e valida mensagens', async () => {
    const response = await request({ method: 'POST', url: '/auth/ws-ticket', headers: authorization() });
    const { ticket } = response.json<{ ticket: string }>();
    const socket = new WebSocket(`${address.replace('http:', 'ws:')}/ws?ticket=${ticket}`);
    await once(socket, 'open');
    const received = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'ping' }));
    const [data] = await received as [Buffer];
    expect(JSON.parse(data.toString())).toEqual({ type: 'pong' });
    expect((await request({ method: 'GET', url: `/ws?ticket=${ticket}` })).statusCode).toBe(401);
    const closed = once(socket, 'close');
    socket.send('invalid-json');
    const closeArgs: unknown[] = await closed;
    expect(closeArgs[0]).toBe(1007);
  });
  it('rotaciona refresh e revoga a família quando detecta replay', async () => {
    const oldToken = pair.refreshToken;
    const refreshed = await request({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: oldToken } });
    expect(refreshed.statusCode).toBe(200);
    pair = refreshed.json<Pair>();
    expect(pair.refreshToken).not.toBe(oldToken);
    expect((await request({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: oldToken } })).statusCode).toBe(401);
    expect((await request({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: pair.refreshToken } })).statusCode).toBe(401);
  });
  it('serializa refresh concorrente e impede manter a família reutilizada', async () => {
    const login = (await request({ method: 'POST', url: '/auth/login', payload: credentials })).json<Pair>();
    const responses = await Promise.all([1, 2].map(() => request({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: login.refreshToken } })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    const rotated = responses.find((response) => response.statusCode === 200)?.json<Pair>();
    expect(rotated).toBeDefined();
    expect((await request({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: rotated?.refreshToken } })).statusCode).toBe(401);
  });
  it('faz logout da família e bloqueia JWT expirado', async () => {
    pair = (await request({ method: 'POST', url: '/auth/login', payload: credentials })).json<Pair>();
    expect((await request({ method: 'POST', url: '/auth/logout', headers: authorization(), payload: { refreshToken: pair.refreshToken } })).statusCode).toBe(204);
    expect((await request({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: pair.refreshToken } })).statusCode).toBe(401);
    const expired = app.jwt.sign({ sub: randomUUID(), type: 'access' }, { expiresIn: -10 });
    expect((await request({ method: 'GET', url: '/notes', headers: { authorization: `Bearer ${expired}` } })).statusCode).toBe(401);
  });
  it('retorna 429 nas rotas de autenticação sob excesso', async () => {
    const responses = [];
    for (let index = 0; index < 12; index++) responses.push(await request({ method: 'POST', url: '/auth/login', payload: {} }));
    expect(responses.some((response) => response.statusCode === 429)).toBe(true);
  });
  it('encerra WebSocket com aviso de reconexão durante shutdown', async () => {
    const socket = new WebSocket(`${address.replace('http:', 'ws:')}/ws`, { headers: authorization() });
    await once(socket, 'open');
    const closed = once(socket, 'close');
    await app.close();
    const args: unknown[] = await closed;
    expect(args[0]).toBe(1012);
  });
});
