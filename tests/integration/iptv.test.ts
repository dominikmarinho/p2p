import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import { xuiFixture } from '../helpers/xui-fixture.js';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) throw new Error('Use serviços dedicados de teste');
const source = xuiFixture();
let app: ReturnType<typeof buildApp>;
let address: string;
let token: string;
let cookie: string;
let playback: { url: string; trackerPath: string; swarmId: string };
const sockets: WebSocket[] = [];
const headers = () => ({ authorization: `Bearer ${token}` });
beforeAll(async () => {
  const origin = await source.listen({ host: '127.0.0.1', port: 0 });
  app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', RATE_LIMIT_MAX: '1000', RATE_LIMIT_NAMESPACE: `test:${randomUUID()}:` }));
  address = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => { for (const socket of sockets) socket.terminate(); if (app !== undefined) await app.close(); await source.close(); });

describe('clientes IPTV e mídia', () => {
  it('valida a linha no XUI sem cadastro local e emite sessão HttpOnly', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'alice', password: 'wrong' } })).statusCode).toBe(401);
    const response = await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'alice', password: 'secret-line' } });
    expect(response.statusCode).toBe(200); expect(response.body).not.toContain('secret-line');
    token = response.json<{ token: string }>().token;
    cookie = String(response.headers['set-cookie']).split(';')[0] ?? '';
    expect(response.headers['set-cookie']).toContain('HttpOnly'); expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect((await app.inject({ url: '/api/iptv/account', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject('/api/iptv/account')).statusCode).toBe(401);
  });
  it('bloqueia origem de navegador não autorizada', async () => {
    expect((await app.inject({ url: '/api/iptv/account', headers: { ...headers(), origin: 'https://evil.example' } })).statusCode).toBe(403);
  });
  it('expõe catálogo paginado, categorias, EPG e episódios autorizados', async () => {
    const channels = await app.inject({ url: '/api/iptv/catalog?kind=live&limit=1', headers: headers() });
    expect(channels.statusCode).toBe(200); expect(channels.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect((await app.inject({ url: '/api/iptv/categories?kind=live', headers: headers() })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/iptv/epg/1', headers: headers() })).body).toContain('Programa ao vivo');
    expect((await app.inject({ url: '/api/iptv/series/3', headers: headers() })).body).toContain('Primeiro episódio');
    expect((await app.inject({ url: '/api/iptv/series/999', headers: headers() })).statusCode).toBe(404);
  });
  it('não concede mídia fora do catálogo da linha', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/iptv/playback', headers: headers(), payload: { kind: 'live', id: '999' } })).statusCode).toBe(404);
    const response = await app.inject({ method: 'POST', url: '/api/iptv/playback', headers: headers(), payload: { kind: 'live', id: '1' } });
    expect(response.statusCode).toBe(200); playback = response.json<typeof playback>();
    expect(response.body).not.toContain('secret-line'); expect(response.body).not.toContain('/alice/');
  });
  it('reescreve playlist, segmentos e chaves sem expor a URL upstream', async () => {
    expect((await app.inject(playback.url)).statusCode).toBe(401);
    const response = await app.inject({ url: playback.url, headers: headers() });
    expect(response.statusCode).toBe(200); expect(response.body).toContain('#EXTM3U');
    expect(response.body).not.toContain('secret-line'); expect(response.body).not.toContain('127.0.0.1');
    const segment = response.body.split('\n').find((line) => line.startsWith('/api/iptv/media/'));
    expect(segment).toBeDefined(); const bytes = await app.inject({ url: segment ?? '', headers: headers() });
    expect([...bytes.rawPayload]).toEqual([1, 2, 3, 4]);
    const key = response.body.match(/URI="([^"]+)"/)?.[1]; expect(key).toBeDefined(); expect((await app.inject({ url: key ?? '', headers: headers() })).statusCode).toBe(200);
    const tampered = playback.url.slice(0, -3) + 'xxx'; expect((await app.inject({ url: tampered, headers: headers() })).statusCode).toBe(400);
  });
  it('preserva Range/206 para VOD e libera episódio validado', async () => {
    const movie = (await app.inject({ method: 'POST', url: '/api/iptv/playback', headers: headers(), payload: { kind: 'movie', id: '2' } })).json<{ url: string; directUrl: string }>();
    const range = await app.inject({ url: movie.directUrl, headers: { ...headers(), range: 'bytes=1-2' } });
    expect(range.statusCode).toBe(206); expect(range.headers['content-range']).toBe('bytes 1-2/4'); expect([...range.rawPayload]).toEqual([2, 3]);
    expect((await app.inject({ method: 'POST', url: '/api/iptv/playback', headers: headers(), payload: { kind: 'episode', id: '4', seriesId: '3' } })).statusCode).toBe(200);
  });
  it('tracker privado encaminha offers e answers de duas linhas no mesmo conteúdo', async () => {
    const secondToken = (await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'bob', password: 'secret-line' } })).json<{ token: string }>().token;
    const secondPlayback = (await app.inject({ method: 'POST', url: '/api/iptv/playback', headers: { authorization: `Bearer ${secondToken}` }, payload: { kind: 'live', id: '1' } })).json<typeof playback>();
    expect(secondPlayback.swarmId).toBe(playback.swarmId);
    const first = new WebSocket(address.replace('http:', 'ws:') + playback.trackerPath, { headers: headers() }); const second = new WebSocket(address.replace('http:', 'ws:') + secondPlayback.trackerPath, { headers: { authorization: `Bearer ${secondToken}` } }); sockets.push(first, second);
    await Promise.all([once(first, 'open'), once(second, 'open')]);
    const announce = { action: 'announce', info_hash: 'h'.repeat(20), peer_id: 'a'.repeat(20), offers: [] };
    const ack = once(first, 'message'); first.send(JSON.stringify(announce)); await ack;
    const offered = once(first, 'message'); second.send(JSON.stringify({ ...announce, peer_id: 'b'.repeat(20), offers: [{ offer_id: 'id-1', offer: { type: 'offer', sdp: 'test-sdp' } }] }));
    const [raw] = await offered as [Buffer]; expect(JSON.parse(raw.toString())).toMatchObject({ peer_id: 'b'.repeat(20), offer_id: 'id-1' });
    const answer = once(second, 'message');
    first.send(JSON.stringify({ ...announce, to_peer_id: 'b'.repeat(20), offer_id: 'id-1', answer: { type: 'answer', sdp: 'test-answer' } }));
    // A confirmação do announce pode chegar antes do answer.
    let [received] = await answer as [Buffer];
    if (!(JSON.parse(received.toString()) as { answer?: unknown }).answer) { const next = await once(second, 'message') as [Buffer]; received = next[0]; }
    expect(JSON.parse(received.toString())).toMatchObject({ answer: { type: 'answer', sdp: 'test-answer' } });
  });
  it('logout revoga inclusive os links de mídia existentes', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/iptv/logout', headers: headers() })).statusCode).toBe(204);
    expect((await app.inject({ url: playback.url, headers: headers() })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/iptv/account', headers: headers() })).statusCode).toBe(401);
  });
});
