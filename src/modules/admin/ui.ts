import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

export async function adminUi(app: FastifyInstance): Promise<void> {
  const root = new URL('../../../public/admin/', import.meta.url);
  const [html, css, js] = await Promise.all([readFile(new URL('index.html', root)), readFile(new URL('admin.css', root)), readFile(new URL('admin.js', root))]);
  const revision = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const document = html.toString().replace('/admin/admin.css', `/admin/admin.css?v=${revision(css)}`).replace('/admin/admin.js', `/admin/admin.js?v=${revision(js)}`);
  app.get('/admin', { config: { disableMetrics: true } }, (_request, reply) => reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(document));
  app.get('/admin/admin.css', { config: { disableMetrics: true } }, (_request, reply) => reply.header('Cache-Control', 'no-store').type('text/css').send(css));
  app.get('/admin/admin.js', { config: { disableMetrics: true } }, (_request, reply) => reply.header('Cache-Control', 'no-store').type('application/javascript').send(js));
}
