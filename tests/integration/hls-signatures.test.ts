import Fastify from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';

const source = Fastify(); let app: ReturnType<typeof buildApp>; let ticket = 0; let offset = 20;
source.get<{ Querystring: { action?: string } }>('/player_api.php', (request) => request.query.action ? [{ stream_id: 1, name: 'Signed live' }] : { user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 3600), max_connections: '1' } });
source.get('/live/:username/:password/:id', (_request, reply) => reply.type('application/x-mpegurl').send(`#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:${offset}\n#EXTINF:4,\n/hls/${offset}.ts?ticket=${++ticket}\n#EXTINF:4,\n/hls/${offset + 1}.ts?ticket=${ticket}\n`));
source.get<{ Querystring: { ticket: string } }>('/hls/:id', (request, reply) => Number(request.query.ticket) === ticket ? reply.type('video/mp2t').send(Buffer.from([0x47, 44])) : reply.code(403).send());
let headers: { authorization: string }; let url: string;
const segments = (body: string) => body.split('\n').filter((line) => line.startsWith('/api/iptv/media/'));
beforeAll(async () => {
  const origin = await source.listen({ host: '127.0.0.1', port: 0 });
  app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', RATE_LIMIT_MAX: '1000', RATE_LIMIT_NAMESPACE: `signatures:${randomUUID()}:` })); await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'alice', password: 'secret-line' } }); headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  url = (await app.inject({ method: 'POST', url: '/api/iptv/playback', headers, payload: { kind: 'live', id: '1' } })).json<{ url: string }>().url;
});
afterAll(async () => { if (app !== undefined) await app.close(); await source.close(); });
it('mantém URI estável para a mesma sequência mesmo com assinatura XUI rotativa', async () => {
  const first = await app.inject({ url, headers }); const next = await app.inject({ url, headers });
  expect(first.statusCode).toBe(200); expect(segments(next.body)).toEqual(segments(first.body));
  expect(next.body).not.toContain('ticket='); expect(next.body).not.toContain('secret-line');
  const data = await app.inject({ url: segments(first.body)[0] ?? '', headers }); expect(data.statusCode).toBe(200); expect([...data.rawPayload]).toEqual([0x47, 44]);
});
it('preserva segmentos sobrepostos quando a janela ao vivo avança', async () => {
  const before = segments((await app.inject({ url, headers })).body); offset++;
  const after = segments((await app.inject({ url, headers })).body); expect(after[0]).toBe(before[1]); expect(after[1]).not.toBe(before[0]);
});
it('nega acesso ao alias de segmento por outra linha', async () => {
  const path = segments((await app.inject({ url, headers })).body)[0] ?? '';
  const login = await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'bob', password: 'secret-line' } });
  expect((await app.inject({ url: path, headers: { authorization: `Bearer ${login.json<{ token: string }>().token}` } })).statusCode).toBe(401);
});
