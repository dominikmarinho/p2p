import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthController } from './auth.controller.js';
import { credentialsDto, refreshDto, tokenPairDto } from './auth.dto.js';

export function authRoutes(app: FastifyInstance, controller: AuthController): void {
  const router = app.withTypeProvider<ZodTypeProvider>();
  const config = { rateLimit: { max: 10, timeWindow: '1 minute' } };
  router.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
  router.post('/register', { config, schema: { body: credentialsDto, response: { 201: z.object({ id: z.uuid() }) } } },
    async (request, reply) => reply.code(201).send(await controller.register(request.body)));
  router.post('/login', { config, schema: { body: credentialsDto, response: { 200: tokenPairDto } } },
    async (request) => controller.login(request.body));
  router.post('/refresh', { config, schema: { body: refreshDto, response: { 200: tokenPairDto } } },
    async (request) => controller.refresh(request.body.refreshToken));
  router.post('/logout', { onRequest: app.authenticate, schema: { body: refreshDto } }, async (request, reply) => {
    await controller.logout(request.body.refreshToken, request.user.sub);
    return reply.code(204).send();
  });
  router.post('/ws-ticket', { onRequest: app.authenticate }, async (request) =>
    controller.issueTicket(request.user.sub, request.user.exp));
}
