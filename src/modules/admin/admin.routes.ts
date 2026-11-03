import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AdminAuthService } from './admin-auth.service.js';
import type { Environment } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import type { AdminService } from './admin.service.js';
import type { XuiServersController } from './xui-servers.controller.js';
import { configDto, routeDto, uuidParams, whitelistDto, xuiServerDto } from './admin.dto.js';

export function adminRoutes(app: FastifyInstance, service: AdminService, xui: XuiServersController, auth: AdminAuthService, env: Environment): void {
  const actors = new WeakMap<object, string>();
  const router = app.withTypeProvider<ZodTypeProvider>();
  router.addHook('onRequest', async (request) => {
    const origin = request.headers.origin;
    if (origin && origin !== new URL(env.PUBLIC_ENGINE_URL).origin && !(env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) throw new AppError(403, 'ADMIN_ORIGIN', 'Origem não permitida');
    if (request.method === 'POST' && request.url === '/api/admin/login') return;
    actors.set(request, await service.authenticate(request));
  });
  const cookie = (token: string, maxAge = 28800) => `HP_ADMIN=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${env.NODE_ENV === 'production' ? '; Secure' : ''}`;
  router.post('/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(256) }).strict() } }, async (request, reply) => {
    const result = await auth.login(request.body.username, request.body.password); reply.header('Set-Cookie', cookie(result.token)); return result.user;
  });
  router.get('/me', async (request) => { const user = await auth.user(request); return { username: user.username, mustChangePassword: user.mustChangePassword }; });
  router.post('/logout', async (request, reply) => { await auth.logout(request); reply.header('Set-Cookie', cookie('', 0)); return reply.code(204).send(); });
  router.put('/change-password', { schema: { body: z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) }).strict() } }, async (request, reply) => {
    const result = await auth.changePassword(request, request.body.currentPassword, request.body.newPassword); reply.header('Set-Cookie', cookie(result.token)); return result.user;
  });
  router.addHook('onSend', async (request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method) && reply.statusCode < 400) await service.audit(actors.get(request) ?? 'unknown', request.method, request.routeOptions.url ?? 'unknown', request.ip);
    return payload;
  });
  router.get('/xui-servers', async () => xui.list());
  router.post('/xui-servers/:id/test', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { params: uuidParams } }, async (request) => xui.testConnection(request.params.id));
  router.post('/xui-servers', { schema: { body: xuiServerDto } }, async (request, reply) => reply.code(201).send(await xui.create(request.body)));
  router.put('/xui-servers/:id', { schema: { params: uuidParams, body: xuiServerDto } }, async (request) => xui.update(request.params.id, request.body));
  router.delete('/xui-servers/:id', { schema: { params: uuidParams } }, async (request, reply) => { await xui.delete(request.params.id); return reply.code(204).send(); });
  router.get('/config', async () => service.config());
  router.put('/config', { schema: { body: configDto } }, async (request) => service.updateConfig(request.body));
  router.get('/routes', async () => service.routes());
  router.put('/routes', { schema: { body: routeDto } }, async (request) => service.saveRoute(request.body));
  router.delete('/routes/:channel', { schema: { params: z.object({ channel: routeDto.shape.channel }) } }, async (request, reply) => { await service.deleteRoute(request.params.channel); return reply.code(204).send(); });
  router.get('/keys', async () => service.keys());
  router.post('/keys', { schema: { body: z.object({ name: z.string().trim().min(1).max(100) }).strict() } }, async (request, reply) => reply.code(201).send(await service.createKey(request.body.name)));
  router.delete('/keys/:id', { schema: { params: uuidParams } }, async (request, reply) => { await service.deleteKey(request.params.id); return reply.code(204).send(); });
  router.put('/keys/:id', { schema: { params: uuidParams, body: z.object({ name: z.string().trim().min(1).max(100) }).strict() } }, async (request) => service.renameKey(request.params.id, request.body.name));
  router.get('/whitelist', async () => service.whitelist());
  router.post('/whitelist', { schema: { body: whitelistDto } }, async (request) => service.addIp(request.body.cidr));
  router.delete('/whitelist/:id', { schema: { params: uuidParams } }, async (request, reply) => { await service.deleteIp(request.params.id); return reply.code(204).send(); });
  router.put('/whitelist/:id', { schema: { params: uuidParams, body: whitelistDto } }, async (request) => service.updateIp(request.params.id, request.body.cidr));
  router.get('/peers', () => Promise.resolve({ connections: app.websocketServer.clients.size, updatedAt: new Date().toISOString() }));
  router.get('/audit', async () => service.auditList());
}
