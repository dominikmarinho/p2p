import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';

export function playerUi(app: FastifyInstance): Promise<void> {
  const root = fileURLToPath(new URL('../../../public/player/', import.meta.url));
  const cache = new Map<string, Buffer>();
  const types: Record<string, string> = { '.webmanifest': 'application/manifest+json; charset=utf-8', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
  const serve = async (relative: string, reply: FastifyReply) => {
    const path = resolve(root, relative);
    if (!path.startsWith(resolve(root) + sep)) return reply.code(404).send();
    try {
      let data = cache.get(path); if (!data) { data = await readFile(path); if (cache.size < 64) cache.set(path, data); }
      reply.header('Cache-Control', path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      return reply.type(types[extname(path)] ?? 'application/octet-stream').send(data);
    } catch { return reply.code(relative === 'index.html' ? 503 : 404).send({ message: 'WebPlayer indisponível; execute npm run build:web' }); }
  };
  app.get('/player', { config: { rateLimit: false, disableMetrics: true } }, async (_request, reply) => serve('index.html', reply));
  app.get<{ Params: { '*': string } }>('/player/*', { config: { rateLimit: false, disableMetrics: true } }, async (request, reply) => serve(request.params['*']?.endsWith('/') ? request.params['*'] + 'index.html' : request.params['*'] === 'http' || request.params['*'] === 'p2p' ? request.params['*'] + '/index.html' : request.params['*'] || 'index.html', reply));
  return Promise.resolve();
}
