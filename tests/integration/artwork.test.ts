import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnvironment } from '../../src/config/env.js';
import { xuiFixture } from '../helpers/xui-fixture.js';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) throw new Error('Serviços exclusivos de teste obrigatórios');
const source = xuiFixture();
let app: ReturnType<typeof buildApp>;
let token = '';
let origin = '';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO3sAAAAASUVORK5CYII=', 'base64');
source.get('/poster.png', (_request, reply) => reply.type('image/png').send(png));
source.get('/poster.svg', (_request, reply) => reply.type('image/svg+xml').send('<svg/>'));
source.get('/large.png', (_request, reply) => reply.type('image/png').send(Buffer.alloc(2 * 1024 * 1024 + 1)));
source.get('/redirect.png', (_request, reply) => reply.redirect('http://127.0.0.1:1/private.png'));
source.addHook('onSend', async (request, _reply, payload) => {
  if ((request.query as { action?: string }).action !== 'get_live_streams') return payload;
  return JSON.stringify(['poster.png', 'poster.svg', 'large.png', 'redirect.png'].map((file, index) => ({ stream_id: index + 1, name: file, category_id: '1', stream_icon: `${origin}/${file}` })));
});
beforeAll(async () => {
  origin = await source.listen({ host: '127.0.0.1', port: 0 });
  app = buildApp(loadEnvironment({ ...process.env, XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', RATE_LIMIT_MAX: '1000', RATE_LIMIT_NAMESPACE: `artwork:${randomUUID()}:` }));
  await app.ready();
  token = (await app.inject({ method: 'POST', url: '/api/iptv/login', payload: { username: 'alice', password: 'secret-line' } })).json<{ token: string }>().token;
});
afterAll(async () => { await app?.close(); await source.close(); });
describe('capas autenticadas sem conteúdo HTTP misto', () => {
  it('exige sessão e conteúdo autorizado no catálogo', async () => {
    expect((await app.inject('/api/iptv/artwork/live/1')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/iptv/artwork/live/999', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
  });
  it('entrega a imagem com cache privado e preserva os bytes', async () => {
    const result = await app.inject({ url: '/api/iptv/artwork/live/1', headers: { authorization: `Bearer ${token}` } });
    expect(result.statusCode).toBe(200); expect(result.headers['content-type']).toBe('image/png');
    expect(result.headers['cache-control']).toBe('private, max-age=300'); expect(result.rawPayload.equals(png)).toBe(true);
  });
  it('bloqueia SVG, arquivos excessivos e redirects fora da origem autorizada', async () => {
    for (const [id, code] of [['2', 'ARTWORK_FORMAT'], ['3', 'ARTWORK_SIZE'], ['4', 'XUI_HOST']]) {
      const result = await app.inject({ url: `/api/iptv/artwork/live/${id}`, headers: { authorization: `Bearer ${token}` } });
      expect(result.statusCode).toBe(502); expect(result.json()).toMatchObject({ code });
    }
  });
});
