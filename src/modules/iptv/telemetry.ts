import { z } from 'zod';
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { IptvService } from './iptv.service.js';
import type { Metrics } from '../../lib/metrics.js';
import { digest } from '../../lib/secrets.js';
import { AppError } from '../../lib/errors.js';
import { clientToken } from './iptv.routes.js';

const dto = z.object({ clientId: z.uuid(), client: z.enum(['web', 'bridge']), mode: z.enum(['waiting', 'http', 'p2p']), http: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), p2p: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), upload: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), error: z.string().regex(/^[a-zA-Z0-9_]{1,64}$/).optional() }).strict();
const errorCodes = new Set(['levelParsingError', 'manifestLoadError', 'manifestParsingError', 'fragLoadError', 'fragLoadTimeOut', 'bufferStalledError', 'bufferAppendError', 'bufferSeekOverHole', 'mediaError', 'HTTP_IO', 'P2P_TIMEOUT']);
const update = `
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',ARGV[1]);
if not redis.call('ZSCORE',KEYS[2],ARGV[2]) and redis.call('ZCARD',KEYS[2])>=4 then return {} end;
local old=redis.call('GET',KEYS[1]); local previous=old and cjson.decode(old) or {http=0,p2p=0,upload=0};
local next=cjson.decode(ARGV[3]); local deltas={};
for i,field in ipairs({'http','p2p','upload'}) do
 deltas[i]=math.max(0,math.min(134217728,next[field]-previous[field]));
 redis.call('HINCRBY',KEYS[3],field,deltas[i]);
end;
redis.call('SET',KEYS[1],ARGV[3],'EX',90); redis.call('ZADD',KEYS[2],ARGV[4],ARGV[2]); redis.call('EXPIRE',KEYS[2],90);
for i=4,6 do redis.call('ZREM',KEYS[i],ARGV[2]); redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',ARGV[1]); end;
redis.call('ZADD',KEYS[tonumber(ARGV[5])],ARGV[4],ARGV[2]); return deltas;
`;

/** Reportado pelos players: diagnóstico operacional, sem finalidade de cobrança. */
export class PlaybackTelemetry {
  constructor(private readonly redis: Redis, private readonly service: IptvService, private readonly metrics: Metrics) {}
  async snapshot() {
    const pipeline = this.redis.pipeline();
    for (const mode of ['waiting', 'http', 'p2p']) pipeline.zremrangebyscore(`highpass:reported:${mode}`, '-inf', Date.now()).zcard(`highpass:reported:${mode}`);
    const counts = await pipeline.exec();
    const failures = await this.redis.lrange('highpass:reported:errors', 0, 19);
    return { scope: 'client-reported', modes: { waiting: Number(counts?.[1]?.[1] ?? 0), http: Number(counts?.[3]?.[1] ?? 0), p2p: Number(counts?.[5]?.[1] ?? 0) }, bytes: await this.redis.hgetall('highpass:reported:totals'), failures: failures.map((raw) => JSON.parse(raw) as { at: string; code: string; client: string }) };
  }
  routes(app: FastifyInstance) {
    app.withTypeProvider<ZodTypeProvider>().post('/telemetry/:grant', { config: { disableMetrics: true, rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (request) => `telemetry:${(request.params as { grant: string }).grant}:${request.ip}` } }, schema: { params: z.object({ grant: z.string().regex(/^[a-f0-9]{64}$/) }), body: dto } }, async (request, reply) => {
      const grant = await this.service.grant(request.params.grant);
      if (digest(clientToken(request)) !== grant.sessionHash) throw new AppError(401, 'MEDIA_OWNER', 'Sessão inválida');
      const input = request.body; const now = Date.now(); const id = digest(`${request.params.grant}:${input.clientId}`);
      const delta = await this.redis.eval(update, 6, `highpass:reported:client:${id}`, `highpass:reported:grant:${digest(request.params.grant)}`, 'highpass:reported:totals', 'highpass:reported:waiting', 'highpass:reported:http', 'highpass:reported:p2p', now, id, JSON.stringify(input), now + 30000, { waiting: 4, http: 5, p2p: 6 }[input.mode]) as number[];
      if (!delta.length) throw new AppError(429, 'TELEMETRY_LIMIT', 'Limite de players por transmissão');
      this.metrics.reportedDown.inc({ transport: 'http', client: input.client }, delta[0] ?? 0); this.metrics.reportedDown.inc({ transport: 'p2p', client: input.client }, delta[1] ?? 0); this.metrics.reportedUp.inc({ client: input.client }, delta[2] ?? 0);
      if (input.error) { const code = errorCodes.has(input.error) ? input.error : 'OTHER'; this.metrics.playbackErrors.inc({ code, client: input.client }); await this.redis.multi().lpush('highpass:reported:errors', JSON.stringify({ at: new Date(now).toISOString(), code, client: input.client })).ltrim('highpass:reported:errors', 0, 49).expire('highpass:reported:errors', 86400).exec(); }
      return reply.code(204).send();
    });
  }
}
