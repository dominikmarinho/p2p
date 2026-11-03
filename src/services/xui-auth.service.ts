import { createHmac, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { streamRoutes, xuiServers } from '../db/schema.js';
import type { Environment } from '../config/env.js';
import type { XuiServersService } from '../modules/admin/xui-servers.service.js';
import type { Metrics } from '../lib/metrics.js';
import { digest } from '../lib/secrets.js';
import { AppError } from '../lib/errors.js';
import { xuiTransportUrl } from '../lib/xui-transport.js';

const credential = z.string().min(1).max(256).refine((value) => !/[\\/]/.test(value) && Array.from(value).every((character) => character.charCodeAt(0) >= 32) && value !== '.' && value !== '..', 'Credencial contém segmento de URL inválido');
export const authorizeDto = z.object({ channel: z.string().regex(/^[\w-]{1,64}$/), username: credential.max(128), password: credential }).strict();
export const peerGrantDto = z.object({ channel: z.string(), line: z.string(), expiresAt: z.number() });
export type PeerGrant = z.infer<typeof peerGrantDto>;
const userDto = z.object({ user_info: z.object({ auth: z.union([z.number(), z.string()]), status: z.string().optional(), exp_date: z.union([z.string(), z.number(), z.null()]).optional() }) });

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Resposta XUI vazia');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) throw new Error('Resposta XUI excedeu 64 KiB');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { await reader.cancel().catch(() => undefined); }
}

export class XuiAuthService {
  constructor(private readonly db: Database, private readonly redis: Redis, private readonly env: Environment, private readonly servers: XuiServersService, private readonly metrics: Metrics) {}

  async authorize(input: z.infer<typeof authorizeDto>) {
    const end = this.metrics.auth.startTimer();
    try {
      const [route] = await this.db.select().from(streamRoutes).where(and(eq(streamRoutes.channel, input.channel), eq(streamRoutes.enabled, true))).limit(1);
      if (!route) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Canal não configurado');
      for (const id of [route.serverId, ...route.fallbackServerIds]) {
        const [server] = await this.db.select().from(xuiServers).where(and(eq(xuiServers.id, id), eq(xuiServers.enabled, true))).limit(1);
        if (!server) continue;
        try {
          const grant = await this.validate(server, route.streamId, input);
          const ticket = randomBytes(32).toString('hex');
          await this.redis.set(`highpass:p2p:ticket:${digest(ticket)}`, JSON.stringify(grant), 'EX', 30);
          end({ result: 'ok' });
          return { ticket, expiresIn: 30, websocketPath: '/p2p/ws' };
        } catch (error) {
          if (error instanceof AppError && error.statusCode < 500) throw error;
          // Falhas de rede/5xx usam apenas fallbacks previamente cadastrados.
        }
      }
      throw new AppError(502, 'XUI_UNAVAILABLE', 'Nenhuma origem XUI disponível');
    } catch (error) { end({ result: 'error' }); throw error; }
  }

  private async validate(server: typeof xuiServers.$inferSelect, streamId: number, input: z.infer<typeof authorizeDto>): Promise<PeerGrant> {
    const base = this.servers.validateUrl(server.baseUrl);
    const cacheKey = `highpass:p2p:auth:${createHmac('sha256', this.env.JWT_SECRET).update(JSON.stringify([server.id, server.updatedAt, streamId, input.username, input.password])).digest('hex')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const expiresAt = Number(cached);
      if (expiresAt > Date.now()) return this.grant(server.id, input, expiresAt);
    }
    const url = new URL('player_api.php', base);
    url.searchParams.set('username', input.username);
    url.searchParams.set('password', input.password);
    const headers: Record<string, string> = { accept: 'application/json' };
    const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(3000) });
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new AppError(401, 'XUI_AUTH', 'Linha não autorizada'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Resposta XUI indisponível'); }
    const parsed = userDto.parse(await boundedJson(response)).user_info;
    if (String(parsed.auth) !== '1' || (parsed.status && parsed.status.toLowerCase() !== 'active')) throw new AppError(401, 'XUI_AUTH', 'Linha não autorizada');
    const accountExpiry = parsed.exp_date ? Number(parsed.exp_date) * 1000 : Date.now() + 900000;
    if (!Number.isFinite(accountExpiry) || accountExpiry <= Date.now()) throw new AppError(401, 'XUI_AUTH', 'Linha expirada');
    const stream = new URL(`live/${encodeURIComponent(input.username)}/${encodeURIComponent(input.password)}/${streamId}.ts`, base);
    const status = await this.probeStream(stream, headers);
    if (status === 401 || status === 403 || status === 404) throw new AppError(403, 'STREAM_DENIED', 'Linha sem acesso ao stream');
    if (status < 200 || status >= 300) throw new Error('Origem de stream indisponível');
    const expiresAt = Math.min(Date.now() + 900000, accountExpiry);
    await this.redis.set(cacheKey, String(expiresAt), 'EX', Math.max(1, Math.min(30, Math.floor((expiresAt - Date.now()) / 1000))));
    return this.grant(server.id, input, expiresAt);
  }
  private async probeStream(initial: URL, headers: Record<string, string>): Promise<number> {
    let url = initial;
    for (let hop = 0; hop < 4; hop++) {
      url = xuiTransportUrl(url, this.env);
      const requestHeaders = url.origin === initial.origin ? headers : { accept: '*/*' };
      let response = await fetch(url, { method: 'HEAD', headers: requestHeaders, redirect: 'manual', signal: AbortSignal.timeout(3000) });
      if (response.status === 405) { await response.body?.cancel(); response = await fetch(url, { headers: requestHeaders, redirect: 'manual', signal: AbortSignal.timeout(3000) }); }
      const status = response.status;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (![301, 302, 303, 307, 308].includes(status) || !location) return status;
      url = this.servers.validateRequestUrl(xuiTransportUrl(new URL(location, url), this.env).href);
    }
    throw new Error('Excesso de redirects no stream');
  }
  private grant(serverId: string, input: z.infer<typeof authorizeDto>, expiresAt: number): PeerGrant {
    return { channel: input.channel, line: createHmac('sha256', this.env.JWT_SECRET).update(`${serverId}:${input.username}`).digest('hex'), expiresAt };
  }
}
