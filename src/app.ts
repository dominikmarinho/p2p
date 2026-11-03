import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { serializerCompiler, validatorCompiler, hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { Environment } from './config/env.js';
import { createDatabase } from './db/index.js';
import { createRedis, closeRedis } from './lib/redis.js';
import { AppError, isUniqueViolation } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { NotesRepository } from './modules/notes/notes.repository.js';
import { NotesService } from './modules/notes/notes.service.js';
import { NotesController } from './modules/notes/notes.controller.js';
import { notesRoutes } from './modules/notes/notes.routes.js';
import { HealthRepository } from './modules/health/health.repository.js';
import { HealthService } from './modules/health/health.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { realtimeRoutes } from './modules/realtime/realtime.routes.js';
import { createMetrics, registerMetrics } from './lib/metrics.js';
import { AdminAuthService } from './modules/admin/admin-auth.service.js';
import { AdminService } from './modules/admin/admin.service.js';
import { XuiServersService } from './modules/admin/xui-servers.service.js';
import { XuiServersController } from './modules/admin/xui-servers.controller.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { adminUi } from './modules/admin/ui.js';
import { XuiAuthService } from './services/xui-auth.service.js';
import { PeerManager } from './services/peer-manager.js';
import { peerRoutes } from './ws/peer.handler.js';
import { RokuRelay } from './modules/iptv/roku-relay.js';
import { VodManager } from './modules/iptv/vod-manager.js';
import { IptvService } from './modules/iptv/iptv.service.js';
import { iptvRoutes } from './modules/iptv/iptv.routes.js';
import { PrivateTracker } from './modules/iptv/tracker.js';
import { playerUi } from './modules/iptv/player-ui.js';

export function buildApp(env: Environment) {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 16384,
    requestTimeout: 10000,
    connectionTimeout: 10000,
    keepAliveTimeout: 5000,
    forceCloseConnections: 'idle',
    trustProxy: env.TRUST_PROXY_HOPS === 1 ? (_address, hop) => hop < 1 : false,
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 4096 },
  });
  const { pool, db } = createDatabase(env);
  const redis = createRedis(env);
  const metrics = createMetrics();
  const adminAuth = new AdminAuthService(db, redis);
  const admin = new AdminService(db, env, adminAuth);
  const servers = new XuiServersService(db, env);
  const peers = new PeerManager(redis, metrics);
  const iptv = new IptvService(redis, env, () => admin.config());
  const relay = new RokuRelay(iptv);
  const vod = new VodManager(iptv, relay);
  const tracker = new PrivateTracker(redis, iptv, metrics, admin);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onReady', async () => {
    await pool.query('SELECT 1');
    await redis.connect();
    await redis.ping();
    await peers.start();
    await tracker.start();
  });
  app.addHook('onClose', async () => {
    peers.close();
    tracker.close();
    await vod.close();
    await relay.close();
    const results = await Promise.allSettled([pool.end(), closeRedis(redis)]);
    for (const result of results) if (result.status === 'rejected') app.log.error({ err: result.reason }, 'Erro ao fechar dependência');
  });
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Dados inválidos', requestId: request.id });
    }
    if (error instanceof AppError) return reply.code(error.statusCode).send({ code: error.code, message: error.message, requestId: request.id });
    if (isUniqueViolation(error)) return reply.code(409).send({ code: 'CONFLICT', message: 'Registro já existe', requestId: request.id });
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'Falha na requisição');
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
      code: statusCode === 429 ? 'RATE_LIMITED' : statusCode < 500 ? 'REQUEST_ERROR' : 'INTERNAL_ERROR',
      message: statusCode === 429 ? 'Limite de requisições excedido' : statusCode < 500 ? 'Requisição inválida' : 'Erro interno',
      requestId: request.id,
    });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND', message: 'Rota não encontrada' }));

  app.register(helmet, { contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'],
    mediaSrc: ["'self'", 'blob:'], workerSrc: ["'self'", 'blob:'],
    connectSrc: ["'self'", new URL(env.PUBLIC_ENGINE_URL).origin.replace(/^http/, 'ws'), ...(env.NODE_ENV !== 'production' ? ['ws:'] : [])],
    upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
  } } });
  registerMetrics(app, env, metrics);
  app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: 'HS256', iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS },
    verify: { algorithms: ['HS256'], allowedIss: env.JWT_ISSUER, allowedAud: env.JWT_AUDIENCE, requiredClaims: ['sub', 'exp', 'type'] },
  });
  app.register(rateLimit, { max: env.RATE_LIMIT_MAX, timeWindow: '1 minute', redis, nameSpace: env.RATE_LIMIT_NAMESPACE, skipOnError: false });
  app.register(websocket, {
    options: { maxPayload: 65536, perMessageDeflate: false },
    preClose: function (done) {
      const server = this.websocketServer;
      const force = setTimeout(() => { for (const client of server.clients) client.terminate(); }, 3000);
      force.unref();
      for (const client of server.clients) client.close(1012, 'Atualização do serviço; reconecte');
      server.close((error) => { clearTimeout(force); done(error); });
    },
    errorHandler(error, socket, request) { request.log.warn({ err: error }, 'Erro no handler WS'); socket.terminate(); },
  });
  app.decorate('authenticate', async function (request) {
    try {
      await request.jwtVerify();
      if (request.user.type !== 'access') throw new Error('Tipo de token inválido');
    } catch { throw new AppError(401, 'UNAUTHORIZED', 'Token inválido ou expirado'); }
  });

  app.register((scope, _options, done) => {
    const auth = new AuthController(new AuthService(new AuthRepository(db), env), app, redis, env);
    authRoutes(scope, auth);
    done();
  }, { prefix: '/auth' });
  app.register((scope, _options, done) => { notesRoutes(scope, new NotesController(new NotesService(new NotesRepository(db)))); done(); }, { prefix: '/notes' });
  app.register((scope, _options, done) => { healthRoutes(scope, new HealthController(new HealthService(new HealthRepository(db, redis)))); done(); });
  app.register((scope, _options, done) => { realtimeRoutes(scope, redis, metrics); done(); });
  app.register(adminUi);
  app.register(playerUi);
  app.register((scope, _options, done) => { vod.routes(scope); done(); });
  app.register((scope, _options, done) => { adminRoutes(scope, admin, new XuiServersController(servers), adminAuth, env); done(); }, { prefix: '/api/admin' });
  app.register((scope, _options, done) => { peerRoutes(scope, redis, new XuiAuthService(db, redis, env, servers, metrics), admin, peers, metrics); done(); });
  app.register((scope, _options, done) => { iptvRoutes(scope, iptv, relay); done(); }, { prefix: '/api/iptv' });
  app.register((scope, _options, done) => { tracker.routes(scope); done(); });
  return app;
}
