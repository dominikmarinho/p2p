import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { tokenHash } from '../auth/auth.service.js';
import type { Metrics } from '../../lib/metrics.js';

const ticketUser = z.object({ sub: z.uuid(), exp: z.number() });
const messageDto = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }).strict(),
  z.object({ type: z.literal('echo'), message: z.string().max(4000) }).strict(),
]);

export function realtimeRoutes(app: FastifyInstance, redis: Redis, metrics: Metrics): void {
  app.get<{ Querystring: { ticket?: string } }>('/ws', {
    websocket: true,
    onRequest: async (request, reply) => {
      if (request.headers.authorization) return app.authenticate(request, reply);
      const ticket = request.query.ticket;
      if (!ticket || !/^[a-f0-9]{64}$/.test(ticket)) throw new AppError(401, 'INVALID_TICKET', 'Ticket obrigatório');
      const raw = await redis.getdel(`highpass:ws:${tokenHash(ticket)}`);
      const parsed = ticketUser.safeParse(raw ? JSON.parse(raw) as unknown : null);
      if (!parsed.success || parsed.data.exp * 1000 <= Date.now()) throw new AppError(401, 'INVALID_TICKET', 'Ticket expirado');
      request.user = { ...parsed.data, type: 'access', iat: Math.floor(Date.now() / 1000) };
    },
  }, (socket, request) => {
    if (app.websocketServer.clients.size > 1000) { socket.close(1013, 'Capacidade atingida'); return; }
    metrics.connections.inc();
    let alive = true;
    let count = 0;
    let windowStart = Date.now();
    const expiry = setTimeout(() => socket.close(1008, 'Autenticação expirada'), Math.max(1, request.user.exp * 1000 - Date.now()));
    expiry.unref();
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      socket.ping();
    }, 25000);
    heartbeat.unref();
    socket.on('pong', () => { alive = true; });
    socket.on('close', () => { clearTimeout(expiry); clearInterval(heartbeat); metrics.connections.dec(); });
    socket.on('error', (error) => request.log.warn({ err: error }, 'Conexão WS encerrada com erro'));
    // Eventos de mensagem não passam pelo error handler HTTP do Fastify.
    socket.on('message', (raw, binary) => {
      metrics.received.inc();
      try {
        if (Date.now() - windowStart >= 1000) { count = 0; windowStart = Date.now(); }
        if (++count > 20) { socket.close(1008, 'Limite de mensagens'); return; }
        if (binary) { socket.close(1003, 'Somente JSON textual'); return; }
        const buffer = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
        const parsed = messageDto.safeParse(JSON.parse(buffer.toString('utf8')) as unknown);
        if (!parsed.success) { socket.close(1008, 'Mensagem inválida'); return; }
        if (socket.bufferedAmount > 1048576) { socket.close(1013, 'Cliente lento'); return; }
        socket.send(JSON.stringify(parsed.data.type === 'ping' ? { type: 'pong' } : parsed.data), (error) => {
          if (error) { request.log.warn({ err: error }, 'Falha de envio WS'); socket.terminate(); }
          else metrics.sent.inc();
        });
      } catch { socket.close(1007, 'JSON inválido'); }
    });
  });
}
