import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export function xuiFixture(mediaFolder?: string, maxConnections = 4) {
  const source = Fastify();
  source.get<{ Querystring: Record<string, string> }>('/player_api.php', (request, reply) => {
    const { username, password, action } = request.query;
    if (!['alice', 'bob'].includes(username ?? '') || password !== 'secret-line') return reply.send({ user_info: { auth: 0 } });
    const categories = [{ category_id: '1', category_name: 'Minha programação' }];
    const data: Record<string, unknown> = {
      get_live_categories: categories, get_vod_categories: categories, get_series_categories: categories,
      get_live_streams: [{ stream_id: 1, name: 'Highpass Teste Ao Vivo', category_id: '1', stream_icon: '' }],
      get_vod_streams: [{ stream_id: 2, name: 'Filme de Teste', category_id: '1', container_extension: 'mp4' }],
      get_series: [{ series_id: 3, name: 'Série de Teste', category_id: '1', cover: '' }],
      get_series_info: { episodes: { '1': [{ id: '4', title: 'Primeiro episódio', container_extension: 'mp4' }] } },
      get_short_epg: { epg_listings: [{ title: Buffer.from('Programa ao vivo').toString('base64'), description: Buffer.from('Programação de validação').toString('base64'), start: '2026-11-02 21:00:00', end: '2026-11-02 22:00:00' }] },
    };
    if (action) return reply.send(data[action] ?? []);
    return reply.send({ user_info: { auth: 1, username, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 86400), max_connections: String(maxConnections) } });
  });
  source.get('/live/:username/:password/:id', async (_request, reply) => {
    const manifest = mediaFolder ? (await readFile(resolve(mediaFolder, 'index.m3u8'), 'utf8')).replace('#EXT-X-ENDLIST', '').replace(/^([^#\n][^\n]*)$/gm, `/hls/$1?ticket=${randomUUID()}`) : '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:41\n#EXT-X-KEY:METHOD=AES-128,URI="/hls/key.bin"\n#EXTINF:4,\n/hls/segment.ts\n';
    return reply.type('application/vnd.apple.mpegurl').send(manifest);
  });
  source.get<{ Params: { file: string } }>('/hls/:file', async (request, reply) => {
    if (!mediaFolder) return reply.type('application/octet-stream').send(Buffer.from([1, 2, 3, 4]));
    const path = resolve(mediaFolder, request.params.file);
    if (!path.startsWith(resolve(mediaFolder) + sep)) return reply.code(404).send();
    return reply.type(request.params.file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t').send(await readFile(path));
  });
  const vod = async (range: string | undefined, reply: FastifyReply) => {
    const bytes = mediaFolder ? await readFile(resolve(mediaFolder, 'movie.mp4')) : Buffer.from([1, 2, 3, 4]);
    reply.header('Accept-Ranges', 'bytes');
    if (range) {
      const match = range.match(/^bytes=(\d+)-(\d*)$/); const start = Number(match?.[1] ?? 0); const end = Math.min(Number(match?.[2] || bytes.length - 1), bytes.length - 1);
      if (start > end) return reply.code(416).header('Content-Range', `bytes */${bytes.length}`).send();
      return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${bytes.length}`).type('video/mp4').send(bytes.subarray(start, end + 1));
    }
    return reply.type('video/mp4').send(bytes);
  };
  source.get('/movie/:username/:password/:id', (request, reply) => vod(request.headers.range, reply));
  source.get('/series/:username/:password/:id', (request, reply) => vod(request.headers.range, reply));
  return source;
}
