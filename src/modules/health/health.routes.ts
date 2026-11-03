import type { FastifyInstance } from 'fastify';
import type { HealthController } from './health.controller.js';

export function healthRoutes(app: FastifyInstance, controller: HealthController): void {
  app.get('/health', { config: { rateLimit: false } }, (_request, reply) => reply.send(controller.live()));
  app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    try { return await controller.ready(); }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
}
