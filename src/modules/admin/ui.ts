import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

export async function adminUi(app: FastifyInstance): Promise<void> {
  const root = new URL('../../../public/admin/', import.meta.url);
  const [html, css, js] = await Promise.all(['index.html', 'admin.css', 'admin.js'].map((file) => readFile(new URL(file, root))));
  app.get('/admin', { config: { disableMetrics: true } }, (_request, reply) => reply.type('text/html; charset=utf-8').send(html));
  app.get('/admin/admin.css', { config: { disableMetrics: true } }, (_request, reply) => reply.type('text/css').send(css));
  app.get('/admin/admin.js', { config: { disableMetrics: true } }, (_request, reply) => reply.type('application/javascript').send(js));
}
