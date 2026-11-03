import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { IptvService } from './iptv.service.js';
import { digest } from '../../lib/secrets.js';
import type { Metrics } from '../../lib/metrics.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import type { AdminService } from '../admin/admin.service.js';
import type { EngineConfig } from '../admin/admin.dto.js';
import { clientToken } from './iptv.routes.js';

const sdp = z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(16000) });
const announceDto = z.object({ action: z.literal('announce'), info_hash: z.string().length(20), peer_id: z.string().min(20).max(100), event: z.enum(['started', 'stopped', 'completed']).optional(), offers: z.array(z.object({ offer_id: z.string().max(100), offer: sdp })).max(5).optional(), answer: sdp.optional(), to_peer_id: z.string().max(100).optional(), offer_id: z.string().max(100).optional() });
const deliveryDto = z.object({ to: z.string(), payload: z.string().max(64000) });
const peerDto = z.object({ instance: z.string(), connection: z.string(), peerId: z.string() });
const joinScript = `redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZSCORE',KEYS[1],ARGV[2]) == false and redis.call('ZCARD',KEYS[1]) >= tonumber(ARGV[3]) then return 0 end; redis.call('ZADD',KEYS[1],ARGV[4],ARGV[2]); redis.call('EXPIRE',KEYS[1],90); redis.call('SET',KEYS[2],ARGV[5],'EX',75); return 1`;

export class PrivateTracker {
  private readonly instance = randomUUID();
  private readonly connections = new Map<string, WebSocket>();
  private readonly subscriber: Redis;
  private profile: { expires: number; value: EngineConfig } | undefined;
  constructor(private readonly redis: Redis, private readonly service: IptvService, private readonly metrics: Metrics, private readonly admin: AdminService) {
    this.subscriber = redis.duplicate({ connectionName: 'highpass-private-tracker' });
    this.subscriber.on('error', () => logger.warn('Tracker: subscriber indisponível'));
    this.subscriber.on('message', (_channel, raw) => {
      try { const data = deliveryDto.parse(JSON.parse(raw) as unknown); this.send(data.to, data.payload); }
      catch { logger.warn('Tracker: mensagem descartada'); }
    });
  }
  async start() { await this.subscriber.connect(); await this.subscriber.subscribe(`highpass:tracker:inbox:${this.instance}`); }
  close() { this.subscriber.disconnect(); }
  private async configuration(): Promise<EngineConfig> {
    if (this.profile && this.profile.expires > Date.now()) return this.profile.value;
    const value = await this.admin.config(); this.profile = { expires: Date.now() + 5000, value }; return value;
  }
  private send(connection: string, payload: string) {
    const socket = this.connections.get(connection);
    if (!socket || socket.readyState !== 1) return;
    if (socket.bufferedAmount > 1048576) { socket.close(1013, 'Cliente lento'); return; }
    socket.send(payload, (error) => { if (error) socket.terminate(); else this.metrics.sent.inc(); });
  }
  private async forward(peer: z.infer<typeof peerDto>, payload: unknown) {
    const raw = JSON.stringify(payload);
    if (peer.instance === this.instance) this.send(peer.connection, raw);
    else await this.redis.publish(`highpass:tracker:inbox:${peer.instance}`, JSON.stringify({ to: peer.connection, payload: raw }));
  }
  routes(app: FastifyInstance) {
    const service = this.service;
    app.get<{ Params: { grant: string } }>('/api/iptv/tracker/:grant', {
      websocket: true,
      config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
      onRequest: async (request) => {
        const permission = await service.grant(request.params.grant);
        if (digest(clientToken(request)) !== permission.sessionHash) throw new AppError(401, 'TRACKER_OWNER', 'Tracker pertence a outra sessão');
        const origin = request.headers.origin;
        if (!service.isRelayRequest(request) && origin && origin !== new URL(service.env.PUBLIC_ENGINE_URL).origin && !(service.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2):\d+$/.test(origin))) throw new AppError(403, 'TRACKER_ORIGIN', 'Origem não permitida');
      },
    }, (socket, request) => {
      if (app.websocketServer.clients.size > 1000) { socket.close(1013, 'Capacidade atingida'); return; }
      const connection = randomUUID();
      this.connections.set(connection, socket); this.metrics.connections.inc();
      const memberships = new Map<string, string>();
      let peerId: string | undefined;
      let accountKey: string | undefined;
      let admitted = false;
      let count = 0; let windowStart = Date.now(); let pending = 0; let chain = Promise.resolve(); let alive = true;
      const heartbeat = setInterval(() => {
        if (!alive) { socket.terminate(); return; } alive = false; socket.ping();
        void service.grant(request.params.grant).then(async () => {
          if (accountKey && admitted) await this.redis.multi().zadd(accountKey, Date.now() + 75000, connection).expire(accountKey, 90).exec();
          for (const [swarm, id] of memberships) await this.redis.multi().expire(`highpass:tracker:peer:${swarm}:${id}`, 75).zadd(`highpass:tracker:swarm:${swarm}`, Date.now() + 75000, id).expire(`highpass:tracker:swarm:${swarm}`, 90).exec();
        }).catch(() => socket.close(1008, 'Reautentique a sessão'));
      }, 25000); heartbeat.unref();
      socket.on('pong', () => { alive = true; }); socket.on('error', () => socket.terminate());
      socket.on('close', () => {
        clearInterval(heartbeat); this.connections.delete(connection); this.metrics.connections.dec();
        void chain.finally(async () => {
          for (const [swarm, id] of memberships) await this.redis.multi().del(`highpass:tracker:peer:${swarm}:${id}`).zrem(`highpass:tracker:swarm:${swarm}`, id).exec();
          if (accountKey) await this.redis.zrem(accountKey, connection);
        }).catch(() => logger.warn('Tracker: presença será removida por TTL'));
      });
      socket.on('message', (raw, binary) => {
        this.metrics.received.inc();
        if (Date.now() - windowStart >= 1000) { count = 0; windowStart = Date.now(); }
        if (binary || ++count > 20 || pending >= 8) { socket.close(1008, 'Limite de sinalização'); return; }
        const buffer = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
        pending++;
        chain = chain.then(async () => {
          const message = announceDto.parse(JSON.parse(buffer.toString()) as unknown);
          if (peerId && peerId !== message.peer_id) throw new Error('Peer ID alterado');
          peerId = message.peer_id;
          const grant = await service.grant(request.params.grant);
          const config = await this.configuration();
          if (!admitted) {
            if (service.isSeedRequest(request)) admitted = true;
            else {
            const account = await service.sessionByHash(grant.sessionHash);
            accountKey = `highpass:tracker:account:${account.accountId}`;
            const accepted = await this.redis.eval("redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1]) >= tonumber(ARGV[2]) then return 0 end; redis.call('ZADD',KEYS[1],ARGV[3],ARGV[4]); redis.call('EXPIRE',KEYS[1],90); return 1", 1, accountKey, Date.now(), Math.min(20, account.maxConnections), Date.now() + 75000, connection);
            if (accepted !== 1) throw new Error('Limite da linha atingido'); admitted = true;
            }
          }
          const swarm = digest(`${grant.swarmId}:${message.info_hash}`); const id = digest(peerId);
          const swarmKey = `highpass:tracker:swarm:${swarm}`; const peerKey = `highpass:tracker:peer:${swarm}:${id}`;
          if (message.event === 'stopped') { await this.redis.multi().del(peerKey).zrem(swarmKey, id).exec(); memberships.delete(swarm); return; }
          if (!memberships.has(swarm) && memberships.size >= 20) throw new Error('Excesso de variantes');
          const record = { instance: this.instance, connection, peerId };
          const accepted = await this.redis.eval(joinScript, 2, swarmKey, peerKey, Date.now(), id, config.maxPeersPerChannel, Date.now() + 75000, JSON.stringify(record));
          if (accepted !== 1) throw new Error('Swarm lotado');
          memberships.set(swarm, id);
          if (message.answer && message.to_peer_id && message.offer_id) {
            const target = await this.redis.get(`highpass:tracker:peer:${swarm}:${digest(message.to_peer_id)}`);
            if (target) await this.forward(peerDto.parse(JSON.parse(target) as unknown), { action: 'announce', info_hash: message.info_hash, peer_id: peerId, answer: message.answer, offer_id: message.offer_id });
          } else {
            const candidates = (await this.redis.zrangebyscore(swarmKey, Date.now(), '+inf', 'LIMIT', 0, 30)).filter((entry) => entry !== id);
            const offers = message.offers ?? [];
            for (let index = 0; index < Math.min(offers.length, candidates.length); index++) {
              const candidate = candidates[index]; const offer = offers[index]; if (!candidate || !offer) continue;
              const target = await this.redis.get(`highpass:tracker:peer:${swarm}:${candidate}`);
              if (target) await this.forward(peerDto.parse(JSON.parse(target) as unknown), { action: 'announce', info_hash: message.info_hash, peer_id: peerId, ...offer });
            }
            this.send(connection, JSON.stringify({ action: 'announce', info_hash: message.info_hash, interval: 30, complete: 0, incomplete: await this.redis.zcard(swarmKey) }));
          }
        }).catch(() => socket.close(1008, 'Tracker: mensagem inválida')).finally(() => { pending--; });
      });
    });
  }
}
