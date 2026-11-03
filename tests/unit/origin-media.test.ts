import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { loadEnvironment } from '../../src/config/env.js';
import { IptvService } from '../../src/modules/iptv/iptv.service.js';

const source = Fastify(); let origin = ''; let opens = 0; let reloads = 0; let chunks = 0; let expired = false; let broken = true;
let service: IptvService;
const data = Buffer.from([0x47, 1, 2, 3]);
source.get('/live/:username/:password/:id', (_request, reply) => {
  opens++; const id = String(opens);
  return reply.header('Set-Cookie', `xui_session=${id}; Path=/; HttpOnly`).redirect(`/opaque/session-${id}`);
});
source.get<{ Params: { id: string } }>('/opaque/:id', (request, reply) => {
  const id = request.params.id.replace('session-', '');
  if (request.headers.cookie !== `xui_session=${id}` || (expired && id === '1')) return reply.code(403).send();
  reloads++;
  return reply.type('application/x-mpegurl').send('#EXTM3U\n#EXT-X-TARGETDURATION:11\n#EXT-X-MEDIA-SEQUENCE:100\n#EXTINF:11,\n/segments/100\n');
});
source.get('/segments/:id', async (_request, reply) => { chunks++; await new Promise<void>((resolve) => setTimeout(resolve, 10)); return reply.type('video/mp2t').send(data); });
source.get('/broken.m3u8', (_request, reply) => { opens++; return reply.redirect('/broken/session'); });
source.get('/broken/session', (_request, reply) => broken ? reply.code(403).send() : reply.type('application/x-mpegurl').send('#EXTM3U\n#EXT-X-ENDLIST\n'));
source.get('/range.mp4', (request, reply) => { expect(request.headers.range).toBe('bytes=1-2'); return reply.code(206).header('Content-Range', 'bytes 1-2/4').type('video/mp4').send(data.subarray(1, 3)); });
source.get('/foreign.m3u8', (_request, reply) => reply.redirect('http://127.0.0.1:1/forbidden'));
source.get('/large.ts', (_request, reply) => reply.type('video/mp2t').send(Buffer.alloc(17 * 1024 * 1024, 0x47)));
source.get('/key', (_request, reply) => reply.redirect(origin.replace('127.0.0.1', 'localhost') + '/private-cookie'));
let keyGeneration = 0;
source.get('/rotating-key', (_request, reply) => reply.type('application/octet-stream').send(Buffer.alloc(16, ++keyGeneration)));
source.get('/no-store.ts', (_request, reply) => reply.header('Cache-Control', 'no-store').type('video/mp2t').send(Buffer.from([++keyGeneration])));
source.get('/private-cookie', (request) => ({ cookie: request.headers.cookie ?? '' }));
beforeAll(async () => { origin = await source.listen({ host: '0.0.0.0', port: 0 }); origin = origin.replace('0.0.0.0', '127.0.0.1'); });
afterAll(async () => { await source.close(); });
beforeEach(() => {
  service?.close(); opens = 0; reloads = 0; chunks = 0; expired = false; broken = true;
  const env = loadEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', REDIS_PASSWORD: 'test-only', JWT_SECRET: 'test-only-secret-at-least-thirty-two-characters', XUI_BASE_URL: origin, XUI_ALLOW_HTTP: 'true', XUI_ALLOWED_HOSTS: new URL(origin.replace('127.0.0.1', 'localhost')).host });
  service = new IptvService({} as Redis, env, () => Promise.resolve({ bufferSeconds: 20, maxUploadKbps: 2048, maxConnectionsPerNode: 6, maxPeersPerChannel: 100 }));
});
afterAll(() => { service.close(); });
const manifest = () => new URL('/live/fixture/not-a-real-password/31.m3u8', origin);

describe('uma sessão XUI compartilhada entre seed e contingência HTTP', () => {
  it('reutiliza a URL opaca e seus cookies por 80 recargas em vez de reabrir 80 sessões', async () => {
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      for (let index = 0; index < 80; index++) {
        const result = await service.fetchMedia(manifest(), {}, 'same-account:same-channel');
        expect(result.status).toBe(200); expect(result.url).toBe(origin + '/opaque/session-1'); expect(await result.text()).toContain('#EXTM3U'); now += 1000;
      }
      expect(opens).toBe(1); expect(reloads).toBe(80);
      expect(service.diagnostics().media).toMatchObject({ playlistOpens: 1, playlistReloads: 79, sessions: 1 });
    } finally { clock.mockRestore(); }
  });
  it('coalesce requisições simultâneas e baixa cada segmento compartilhado uma única vez', async () => {
    const playlists = await Promise.all(Array.from({ length: 20 }, () => service.fetchMedia(manifest(), {}, 'same-account:same-channel')));
    expect(opens).toBe(1); expect(reloads).toBe(1); expect(await Promise.all(playlists.map((value) => value.text()))).toHaveLength(20);
    const segments = await Promise.all(Array.from({ length: 40 }, () => service.fetchMedia(new URL('/segments/100', origin), {}, 'same-account:same-channel')));
    for (const response of segments) expect(Buffer.from(await response.arrayBuffer()).equals(data)).toBe(true);
    expect(chunks).toBe(1); expect(service.diagnostics().media.coalesced).toBeGreaterThanOrEqual(58);
    expect(Buffer.from(await (await service.fetchMedia(new URL('/segments/100', origin), {}, 'same-account:same-channel')).arrayBuffer()).equals(data)).toBe(true);
    expect(chunks).toBe(1); expect(service.diagnostics().media.cacheHits).toBeGreaterThan(0);
  });
  it('renova uma sessão expirada só uma vez e isola contas diferentes', async () => {
    await (await service.fetchMedia(manifest(), {}, 'account-a:31')).text();
    expired = true; await new Promise<void>((resolve) => setTimeout(resolve, 550));
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => service.fetchMedia(manifest(), {}, 'account-a:31')));
    expect(concurrent.every((value) => value.status === 200)).toBe(true); expect(opens).toBe(2);
    expect((await service.fetchMedia(manifest(), {}, 'account-b:31')).status).toBe(200); expect(opens).toBe(3); expect(service.diagnostics().media.playlistOpens).toBe(3);
  });
  it('limita novas aberturas durante falha persistente e recupera após o cooldown', async () => {
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const url = new URL('/broken.m3u8', origin);
      const concurrent = await Promise.all(Array.from({ length: 20 }, () => service.fetchMedia(url, {}, 'line:broken')));
      expect(concurrent.every((value) => value.status === 403)).toBe(true); expect(opens).toBe(1);
      for (let index = 0; index < 20; index++) {
        now += 100;
        await service.fetchMedia(url, {}, 'line:broken').then((value) => expect(value.status).toBe(403), (error: unknown) => expect(error).toMatchObject({ code: 'MEDIA_RETRY' }));
      }
      expect(opens).toBe(2);
      broken = false; now += 4100;
      const recovered = await service.fetchMedia(url, {}, 'line:broken'); expect(recovered.status).toBe(200); expect(opens).toBe(3); expect(await recovered.text()).toContain('#EXTM3U');
      now += 600;
      expect((await service.fetchMedia(url, {}, 'line:broken')).status).toBe(200); expect(opens).toBe(3);
    } finally { clock.mockRestore(); }
  });
  it('preserva Range/206, streams acima do cache e a validação de redirects', async () => {
    const ranged = await service.fetchMedia(new URL('/range.mp4', origin), { headers: { Range: 'bytes=1-2' } }, 'line:31');
    expect(ranged.status).toBe(206); expect(ranged.headers.get('content-range')).toBe('bytes 1-2/4'); expect([...new Uint8Array(await ranged.arrayBuffer())]).toEqual([1, 2]);
    const large = await service.fetchMedia(new URL('/large.ts', origin), {}, 'line:31'); expect((await large.arrayBuffer()).byteLength).toBe(17 * 1024 * 1024); expect(service.diagnostics().media.cachedEntries).toBe(0);
    await expect(service.fetchMedia(new URL('/foreign.m3u8', origin), {}, 'line:31')).rejects.toMatchObject({ code: 'XUI_HOST' });
  });
  it('não envia o cookie da origem a outro host autorizado', async () => {
    await (await service.fetchMedia(manifest(), {}, 'line:31')).text();
    const response = await service.fetchMedia(new URL('/key', origin), {}, 'line:31'); expect(await response.json()).toEqual({ cookie: '' });
  });
  it('não conserva chaves rotativas nem mídia marcada como no-store', async () => {
    for (const path of ['/rotating-key', '/no-store.ts']) {
      const first = new Uint8Array(await (await service.fetchMedia(new URL(path, origin), {}, 'line:31')).arrayBuffer());
      const second = new Uint8Array(await (await service.fetchMedia(new URL(path, origin), {}, 'line:31')).arrayBuffer());
      expect(first[0]).not.toBe(second[0]);
    }
    expect(service.diagnostics().media.cachedEntries).toBe(0);
  });

});
