import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import type { IptvService } from './iptv.service.js';
import type { RokuRelay } from './roku-relay.js';
import type { Metrics } from '../../lib/metrics.js';
import { clientToken } from './iptv.routes.js';
import { digest } from '../../lib/secrets.js';
import { AppError } from '../../lib/errors.js';

interface Viewer { token: string; lastSeen: number; position: number }
interface Seed { warmPositions: number[]; revision: number; key: string; swarm: string; kind: string; content: string; owner: string; base: string; viewers: Map<string, Viewer>; idleSince: number; retryAt: number; ready: boolean; lastSegmentAt: number; originBytes: number; uploaded: number }
export class SeedManager {
  private readonly entries = new Map<string, Seed>();
  private readonly timer: NodeJS.Timeout;
  private running = false;
  private closed = false;
  constructor(private readonly service: IptvService, private readonly relay: RokuRelay, private readonly metrics: Metrics) {
    this.timer = setInterval(() => { void this.tick(); }, 1000); this.timer.unref();
  }
  async close() { this.closed = true; clearInterval(this.timer); await Promise.allSettled([...this.entries.values()].map((seed) => this.relay.stopSeed(seed.key))); this.entries.clear(); }
  snapshot() {
    return { enabled: this.service.env.P2P_SEED_ENABLED, active: this.entries.size, ready: [...this.entries.values()].filter((seed) => seed.ready).length, streams: [...this.entries.values()].map((seed) => ({ swarm: seed.swarm, kind: seed.kind, content: seed.content, viewers: seed.viewers.size, ready: seed.ready, warmPositions: seed.warmPositions, lastSegmentAt: seed.lastSegmentAt, originBytes: seed.originBytes, p2pUploaded: seed.uploaded })) };
  }
  async restart(swarm: string, delay = 5000) {
    const seed = this.entries.get(swarm); if (!seed) throw new AppError(404, 'SEED_NOT_FOUND', 'Seed não encontrado');
    seed.revision++; seed.retryAt = Date.now() + delay; seed.ready = false; seed.warmPositions = []; seed.originBytes = 0; seed.uploaded = 0;
    await this.relay.stopSeed(seed.key);
    return { ok: true };
  }
  private async tick() {
    if (this.closed || this.running) return; this.running = true;
    try {
      await Promise.allSettled([...this.entries.values()].map(async (seed) => {
        const revision = seed.revision;
        for (const [grant, viewer] of seed.viewers) if (Date.now() - viewer.lastSeen > 35000) seed.viewers.delete(grant);
        if (!seed.viewers.size) {
          await this.relay.seedStatus(seed.key, []); seed.ready = false;
          if (!seed.idleSince) seed.idleSince = Date.now();
          if (Date.now() - seed.idleSince > 90000) { this.entries.delete(seed.swarm); await this.relay.stopSeed(seed.key); }
          return;
        }
        seed.idleSince = 0;
        if (Date.now() < seed.retryAt) return;
        if (!seed.viewers.has(seed.owner)) { const next = seed.viewers.keys().next().value; if (!next) return; seed.owner = next; await this.relay.stopSeed(seed.key); seed.originBytes = 0; seed.uploaded = 0; }
        const owner = seed.viewers.get(seed.owner); if (!owner) return;
        try { await this.service.grant(seed.owner); }
        catch { seed.viewers.delete(seed.owner); seed.ready = false; await this.relay.stopSeed(seed.key); return; }
        if (!await this.relay.startSeed(seed.key, seed.owner, owner.token, seed.base)) { seed.ready = false; seed.retryAt = Date.now() + 5000; return; }
        const positions = [...seed.viewers.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 32).map((viewer) => viewer.position);
        const status = await this.relay.seedStatus(seed.key, positions); if (revision !== seed.revision || this.entries.get(seed.swarm) !== seed) return; seed.ready = Boolean(status?.ready); seed.lastSegmentAt = status?.lastSegmentAt ?? 0; seed.warmPositions = status?.positions ?? [];
        const traffic = this.relay.stats(seed.key);
        if (traffic) {
          this.metrics.seedOrigin.inc(Math.max(0, traffic.httpDownloaded - seed.originBytes)); this.metrics.seedUpload.inc(Math.max(0, traffic.p2pUploaded - seed.uploaded));
          seed.originBytes = traffic.httpDownloaded; seed.uploaded = traffic.p2pUploaded;
        }
      }));
      this.metrics.seedActive.set(this.entries.size); this.metrics.seedReady.set([...this.entries.values()].filter((seed) => seed.ready).length); this.metrics.seedViewers.set([...this.entries.values()].reduce((sum, seed) => sum + seed.viewers.size, 0));
    } finally { this.running = false; }
  }
  routes(app: FastifyInstance) {
    const router = app.withTypeProvider<ZodTypeProvider>();
    const params = z.object({ grant: z.string().regex(/^[a-f0-9]{64}$/) });
    const own = async (token: string, id: string) => { const grant = await this.service.grant(id); if (digest(token) !== grant.sessionHash) throw new AppError(401, 'MEDIA_OWNER', 'Sessão inválida'); return grant; };
    router.post('/seed/:grant', { config: { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: (request) => `seed:${(request.params as { grant: string }).grant}:${request.ip}` }, disableMetrics: true }, schema: { params, body: z.object({ position: z.number().finite().min(0).max(864000).default(0) }).strict() } }, async (request) => {
      const token = clientToken(request); const grant = await own(token, request.params.grant);
      if (!this.service.env.P2P_SEED_ENABLED || this.closed) return { state: 'unavailable', reason: 'disabled' };
      let seed = this.entries.get(grant.swarmId);
      if (!seed) {
        if (this.entries.size >= this.service.env.P2P_SEED_MAX_STREAMS) {
          const idle = [...this.entries.values()].find((entry) => !entry.viewers.size);
          if (idle) { this.entries.delete(idle.swarm); await this.relay.stopSeed(idle.key); }
        }
        if (this.entries.size >= this.service.env.P2P_SEED_MAX_STREAMS) return { state: 'unavailable', reason: 'capacity' };
        const address = app.server.address(); if (!address || typeof address === 'string') return { state: 'unavailable', reason: 'not-listening' };
        seed = { warmPositions: [], revision: 0, key: `seed:${grant.swarmId}`, swarm: grant.swarmId, kind: grant.kind, content: grant.id, owner: request.params.grant, base: `http://127.0.0.1:${address.port}`, viewers: new Map(), idleSince: 0, retryAt: 0, ready: false, lastSegmentAt: 0, originBytes: 0, uploaded: 0 }; this.entries.set(grant.swarmId, seed);
      }
      if (seed.viewers.size < 256 || seed.viewers.has(request.params.grant)) seed.viewers.set(request.params.grant, { token, position: request.body.position, lastSeen: Date.now() });
      void this.tick(); return { state: seed.ready ? 'ready' : 'warming', viewers: seed.viewers.size };
    });
    router.delete('/seed/:grant', { config: { rateLimit: false, disableMetrics: true }, schema: { params } }, async (request, reply) => { const grant = await own(clientToken(request), request.params.grant); this.entries.get(grant.swarmId)?.viewers.delete(request.params.grant); return reply.code(204).send(); });
  }
}
