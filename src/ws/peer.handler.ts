import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { Metrics } from '../lib/metrics.js';
import { digest } from '../lib/secrets.js';
import { AppError } from '../lib/errors.js';
import type { AdminService } from '../modules/admin/admin.service.js';
import { authorizeDto, peerGrantDto, type PeerGrant, type XuiAuthService } from '../services/xui-auth.service.js';
import type { PeerManager } from '../services/peer-manager.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const signalDto = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }).strict(),
  z.object({ type: z.literal('signal'), to: z.uuid(), data: z.object({ kind: z.enum(['offer', 'answer', 'ice']), payload: z.string().max(6000) }).strict() }).strict(),
]);

export function peerRoutes(app: FastifyInstance, redis: Redis, auth: XuiAuthService, admin: AdminService, manager: PeerManager, metrics: Metrics): void {
  app.withTypeProvider<ZodTypeProvider>().post('/p2p/authorize', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: authorizeDto } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return auth.authorize(request.body);
  });
  const grants = new WeakMap<object, PeerGrant>();
  app.get<{ Querystring: { ticket?: string } }>('/p2p/ws', {
    websocket: true,
    onRequest: async (request) => {
      const ticket = request.query.ticket;
      if (!ticket || !/^[a-f0-9]{64}$/.test(ticket)) throw new AppError(401, 'P2P_TICKET', 'Ticket P2P obrigatório');
      const raw = await redis.getdel(`highpass:p2p:ticket:${digest(ticket)}`);
      const parsed = peerGrantDto.safeParse(raw ? JSON.parse(raw) as unknown : null);
      if (!parsed.success || parsed.data.expiresAt <= Date.now()) throw new AppError(401, 'P2P_TICKET', 'Ticket P2P inválido');
      grants.set(request, parsed.data);
    },
  }, (socket, request) => {
    const grant = grants.get(request);
    if (!grant) { socket.close(1008, 'Sem autorização'); return; }
    const id = randomUUID();
    let alive = true;
    let busy = false;
    let count = 0;
    let start = Date.now();
    const joined = admin.config().then(async (config) => {
      const peers = await manager.join(id, socket, grant, config);
      manager.send(id, JSON.stringify({ type: 'welcome', peerId: id, channel: grant.channel, peers, config }));
    });
    void joined.catch(() => socket.close(1013, 'Swarm indisponível'));
    const expiry = setTimeout(() => socket.close(1008, 'Revalide sua linha'), Math.max(1, grant.expiresAt - Date.now()));
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false; socket.ping();
      void joined.then(() => manager.touch(id, grant)).catch(() => socket.close(1011, 'Estado indisponível'));
    }, 25000);
    expiry.unref(); heartbeat.unref();
    socket.on('pong', () => { alive = true; });
    socket.on('close', () => {
      clearTimeout(expiry); clearInterval(heartbeat);
      void joined.catch(() => undefined).then(() => manager.leave(id, grant)).catch(() => request.log.warn('Falha ao remover peer; TTL fará limpeza'));
    });
    socket.on('error', () => socket.terminate());
    socket.on('message', (raw, binary) => {
      metrics.received.inc();
      if (Date.now() - start >= 1000) { count = 0; start = Date.now(); }
      if (binary || ++count > 20 || busy) { socket.close(1008, 'Limite de sinalização'); return; }
      busy = true;
      void (async () => {
        const buffer = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
        const message = signalDto.parse(JSON.parse(buffer.toString('utf8')) as unknown);
        await joined;
        if (message.type === 'ping') manager.send(id, JSON.stringify({ type: 'pong' }));
        else await manager.signal(id, message.to, grant, message.data);
      })().catch(() => socket.close(1008, 'Sinalização inválida')).finally(() => { busy = false; });
    });
  });
}
