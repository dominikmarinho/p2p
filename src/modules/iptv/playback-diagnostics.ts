import { z } from 'zod';
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { IptvService } from './iptv.service.js';
import { clientToken } from './iptv.routes.js';
import { digest, encrypt, decrypt } from '../../lib/secrets.js';
import { AppError } from '../../lib/errors.js';

const number = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const sample = z.object({
  startup: z.object({ attempt: z.uuid(), clickedAt: z.iso.datetime(), kind: z.enum(['live', 'movie', 'episode']), content: z.string().regex(/^[0-9]{1,20}$/), elapsedMs: number, marks: z.object({ startupAligned: number.optional(), authorization: number.optional(), playerCreated: number.optional(), manifest: number.optional(), seedReady: number.optional(), peerConnected: number.optional(), firstByte: number.optional(), firstSegment: number.optional(), firstFrame: number.optional() }).strict(), error: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(), frameMethod: z.enum(['video-frame-callback', 'playing-fallback']).optional() }).strict().optional(),
  time: number, ready: z.number().int().min(0).max(4), paused: z.boolean(), rate: z.number().finite().min(0).max(16),
  buffered: z.array(z.tuple([number, number])).max(16), width: number, height: number, frames: number, dropped: number,
  peers: z.number().int().min(0).max(1000), http: number, p2p: number, upload: number,
  latency: z.number().finite().min(-864000).max(864000).nullable(), targetLatency: number.nullable(), waiting: number,
  events: z.array(z.object({ at: number, code: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }).strict()).max(20),
  segment: z.object({ sequence: z.string().regex(/^(?:[0-9]+|initSegment)$/), start: number, duration: number, loadMs: number }).strict().optional(),
  frame: z.string().max(64000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/).optional(),
  frameStatus: z.enum(['captured', 'no-video', 'blocked', 'disabled']),
}).strict();
const params = z.object({ grant: z.union([z.string().regex(/^[a-f0-9]{64}$/), z.literal('startup')]), client: z.uuid() });
const indexKey = 'highpass:diagnostic:index';
/** Opt-in only. One encrypted latest sample, no recording/history, expires in sixty seconds. */
export class PlaybackDiagnostics {
  constructor(private readonly redis: Redis, private readonly service: IptvService) {}
  private key(grant: string, client: string) { return digest(`${grant}:${client}`); }
  async snapshot() {
    await this.redis.zremrangebyscore(indexKey, '-inf', Date.now());
    const ids = await this.redis.zrangebyscore(indexKey, Date.now(), '+inf', 'LIMIT', 0, 20);
    if (!ids.length) return [];
    const values = await this.redis.mget(...ids.map((id) => `highpass:diagnostic:data:${id}`));
    return values.flatMap((value) => { try { return value ? [JSON.parse(decrypt(value, this.service.env.CONFIG_ENCRYPTION_KEY)) as unknown] : []; } catch { return []; } });
  }
  routes(app: FastifyInstance) {
    const router = app.withTypeProvider<ZodTypeProvider>();
    const own = async (request: Parameters<typeof clientToken>[0], id: string) => {
      if (id === 'startup') { const token = clientToken(request); await this.service.session(token); return { sessionHash: digest(token), kind: 'startup', id: 'pending' }; }
      const grant = await this.service.grant(id);
      if (digest(clientToken(request)) !== grant.sessionHash) throw new AppError(401, 'MEDIA_OWNER', 'Diagnóstico pertence a outra sessão');
      return grant;
    };
    router.post('/diagnostics/:grant/:client/start', { config: { disableMetrics: true, rateLimit: { max: 6, timeWindow: '1 minute' } }, schema: { params } }, async (request) => {
      const grant = await own(request, request.params.grant); const id = this.key(request.params.grant === 'startup' ? `startup:${grant.sessionHash}` : request.params.grant, request.params.client);
      const result = await this.redis.eval("redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',ARGV[1]); if redis.call('EXISTS',KEYS[1])==0 or redis.call('GET',KEYS[1])=='stopped' then if redis.call('ZCARD',KEYS[2])>=20 then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'EX',600); end; redis.call('ZADD',KEYS[2],ARGV[3],ARGV[4]); redis.call('EXPIRE',KEYS[2],660); return 1", 2, `highpass:diagnostic:lease:${id}`, indexKey, Date.now(), String(Date.now()), Date.now() + 60000, id);
      if (result !== 1) throw new AppError(429, 'DIAGNOSTIC_LIMIT', 'Limite de diagnósticos ativos');
      return { code: id.slice(0, 12), expiresIn: 600 };
    });
    router.post('/diagnostics/:grant/:client', { bodyLimit: 80000, config: { disableMetrics: true, rateLimit: { max: 18, timeWindow: '1 minute', keyGenerator: (request) => `diagnostic:${(request.params as { grant: string }).grant}` } }, schema: { params, body: sample } }, async (request, reply) => {
      const grant = await own(request, request.params.grant); const id = this.key(request.params.grant === 'startup' ? `startup:${grant.sessionHash}` : request.params.grant, request.params.client);
      if (request.params.grant === 'startup' && (request.body.frame || request.body.frameStatus !== 'disabled')) throw new AppError(400, 'STARTUP_METADATA_ONLY', 'Análise de abertura aceita somente dados, sem imagens');
      if (request.body.frame) { const bytes = Buffer.from(request.body.frame.slice(23), 'base64'); if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new AppError(400, 'DIAGNOSTIC_FRAME', 'Imagem JPEG inválida'); }
      const value = encrypt(JSON.stringify({ ...request.body, scope: request.params.grant === 'startup' ? 'startup' : 'playback', code: id.slice(0, 12), at: new Date().toISOString(), kind: request.params.grant === 'startup' ? request.body.startup?.kind ?? 'startup' : grant.kind, content: request.params.grant === 'startup' ? request.body.startup?.content ?? 'pending' : grant.id }), this.service.env.CONFIG_ENCRYPTION_KEY);
      const saved = await this.redis.eval("local lease=redis.call('GET',KEYS[1]); if not lease or lease=='stopped' then return 0 end; redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',ARGV[4]); if not redis.call('ZSCORE',KEYS[3],ARGV[3]) and redis.call('ZCARD',KEYS[3])>=20 then return -1 end; redis.call('SET',KEYS[2],ARGV[1],'EX',60); redis.call('ZADD',KEYS[3],ARGV[2],ARGV[3]); redis.call('EXPIRE',KEYS[3],660); return 1", 3, `highpass:diagnostic:lease:${id}`, `highpass:diagnostic:data:${id}`, indexKey, value, Date.now() + 60000, id, Date.now());
      if (saved === -1) throw new AppError(429, 'DIAGNOSTIC_LIMIT', 'Limite de diagnósticos ativos');
      if (saved !== 1) throw new AppError(410, 'DIAGNOSTIC_EXPIRED', 'Diagnóstico encerrado; ative novamente se desejar');
      return reply.code(204).send();
    });
    router.delete('/diagnostics/:grant/:client', { config: { disableMetrics: true, rateLimit: false }, schema: { params } }, async (request, reply) => {
      const grant = await own(request, request.params.grant); const id = this.key(request.params.grant === 'startup' ? `startup:${grant.sessionHash}` : request.params.grant, request.params.client);
      await this.redis.multi().set(`highpass:diagnostic:lease:${id}`, 'stopped', 'EX', 600).del(`highpass:diagnostic:data:${id}`).zrem(indexKey, id).exec();
      return reply.code(204).send();
    });
  }
}
