import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Metrics } from '../lib/metrics.js';
import { logger } from '../lib/logger.js';
import type { PeerGrant } from './xui-auth.service.js';
import type { EngineConfig } from '../modules/admin/admin.dto.js';

const presenceDto = z.object({ id: z.uuid(), channel: z.string(), line: z.string(), instance: z.uuid() });
const deliveryDto = z.object({ to: z.uuid(), payload: z.string().max(12000) });
const joinScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) or redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3]); redis.call('EXPIRE', KEYS[1], 90)
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3]); redis.call('EXPIRE', KEYS[2], 90)
redis.call('SET', KEYS[3], ARGV[6], 'EX', 75)
return 1`;

export class PeerManager {
  readonly instance = randomUUID();
  private readonly local = new Map<string, WebSocket>();
  private readonly subscriber: Redis;
  constructor(private readonly redis: Redis, private readonly metrics: Metrics) {
    this.subscriber = redis.duplicate({ connectionName: 'highpass-p2p-signals' });
    this.subscriber.on('error', (error) => logger.error({ err: error }, 'Falha no subscriber P2P'));
    this.subscriber.on('message', (_channel, raw) => {
      try {
        const message = deliveryDto.parse(JSON.parse(raw) as unknown);
        this.send(message.to, message.payload);
      } catch { logger.warn('Mensagem de sinalização descartada'); }
    });
  }
  async start(): Promise<void> { await this.subscriber.connect(); await this.subscriber.subscribe(`highpass:p2p:inbox:${this.instance}`); }
  close(): void { this.subscriber.disconnect(); }
  async join(id: string, socket: WebSocket, grant: PeerGrant, config: EngineConfig): Promise<string[]> {
    if (this.local.size >= 1000) throw new Error('Limite de conexões do processo');
    const record = { id, ...grant, instance: this.instance };
    const accepted = await this.redis.eval(joinScript, 3, this.swarm(grant.channel), this.line(grant.line), this.peer(id), Date.now(), Date.now() + 75000, id, config.maxPeersPerChannel, config.maxConnectionsPerNode, JSON.stringify(record));
    if (accepted !== 1) throw new Error('Limite de peers atingido');
    this.local.set(id, socket);
    this.metrics.connections.inc();
    const peers = await this.redis.zrangebyscore(this.swarm(grant.channel), Date.now(), '+inf', 'LIMIT', 0, 20);
    return peers.filter((peer) => peer !== id);
  }
  async leave(id: string, grant: PeerGrant): Promise<void> {
    if (this.local.delete(id)) this.metrics.connections.dec();
    await this.redis.multi().del(this.peer(id)).zrem(this.swarm(grant.channel), id).zrem(this.line(grant.line), id).exec();
  }
  async touch(id: string, grant: PeerGrant): Promise<void> {
    await this.redis.multi().expire(this.peer(id), 75).zadd(this.swarm(grant.channel), Date.now() + 75000, id).expire(this.swarm(grant.channel), 90).zadd(this.line(grant.line), Date.now() + 75000, id).expire(this.line(grant.line), 90).exec();
  }
  async signal(from: string, to: string, grant: PeerGrant, data: unknown): Promise<void> {
    const raw = await this.redis.get(this.peer(to));
    if (!raw) throw new Error('Peer indisponível');
    const peer = presenceDto.parse(JSON.parse(raw) as unknown);
    if (peer.channel !== grant.channel || peer.id === from) throw new Error('Swarm incompatível');
    const payload = JSON.stringify({ type: 'signal', from, data });
    if (peer.instance === this.instance) this.send(to, payload);
    else await this.redis.publish(`highpass:p2p:inbox:${peer.instance}`, JSON.stringify({ to, payload }));
  }
  send(id: string, payload: string): void {
    const socket = this.local.get(id);
    if (!socket || socket.readyState !== 1) return;
    if (socket.bufferedAmount > 1048576) { socket.close(1013, 'Cliente lento'); return; }
    socket.send(payload, (error) => { if (error) socket.terminate(); else this.metrics.sent.inc(); });
  }
  private swarm(channel: string) { return `highpass:p2p:swarm:${channel}`; }
  private line(line: string) { return `highpass:p2p:line:${line}`; }
  private peer(id: string) { return `highpass:p2p:peer:${id}`; }
}
