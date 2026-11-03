import { createHmac, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Metrics } from '../../lib/metrics.js';
import type { Environment } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { xuiTransportUrl } from '../../lib/xui-transport.js';
import { decrypt, digest, encrypt, encryptResource, decryptResource } from '../../lib/secrets.js';
import { accountDto, mediaGrantDto, sessionDto, type CatalogItem, type ClientSession, type ContentKind, type MediaGrant } from './iptv.dto.js';
import type { EngineConfig } from '../admin/admin.dto.js';
import { OriginMedia, originCookies, rememberOriginCookies, type OriginContext } from './origin-media.js';

export async function readBounded(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new AppError(502, 'XUI_EMPTY', 'Origem sem resposta');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) throw new AppError(502, 'XUI_TOO_LARGE', 'Resposta da origem excedeu o limite'); chunks.push(next.value); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => undefined); }
}

const object = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, fallback = '') => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
const safeExtension = (value: unknown) => ['mp4', 'mkv', 'avi', 'm3u8', 'ts', 'webm'].includes(string(value).toLowerCase()) ? string(value).toLowerCase() : 'mp4';

export class IptvService {
  readonly relaySecret = randomBytes(32).toString('hex');
  private active = 0;
  private readonly catalogs = new Map<string, { expires: number; items: CatalogItem[] }>();
  private readonly media = new OriginMedia((url, init, context) => this.fetch(url, init, context));
  close() { this.media.close(); }
  fetchMedia(url: URL, options: RequestInit, scope: string) { return this.media.fetch(url, options, scope); }
  private readonly validations = new Map<string, Promise<ClientSession>>();
  constructor(private readonly redis: Redis, readonly env: Environment, private readonly configuration: () => Promise<EngineConfig>, private readonly metrics?: Metrics) {}
  private readonly errors: { at: string; kind: string; code: string }[] = [];
  diagnostics() { return { pendingMetadata: this.active, recentFailures: [...this.errors], media: this.media.diagnostics() }; }
  private failure(kind: string, code: string) { this.metrics?.upstreamErrors.inc({ kind, code }); this.errors.push({ at: new Date().toISOString(), kind, code }); if (this.errors.length > 20) this.errors.shift(); }
  origin(): URL {
    const url = new URL(this.env.XUI_BASE_URL);
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  }
  checkUpstream(url: URL): void {
    const allowed = new Set([this.origin().host, ...this.env.XUI_ALLOWED_HOSTS.split(',').map((host) => host.trim())]);
    if (!allowed.has(url.host) || !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !this.env.XUI_ALLOW_HTTP) || url.username || url.password) throw new AppError(502, 'XUI_HOST', 'Host ou protocolo de origem não autorizado');
  }
  async fetch(url: URL, options: RequestInit = {}, context?: OriginContext): Promise<Response> {
    const kind = url.pathname.includes('player_api.php') ? 'metadata' : /\.m3u8$/.test(url.pathname) ? 'playlist' : /\.(?:png|jpe?g|webp|gif|avif)$/i.test(url.pathname) ? 'artwork' : 'media';
    const start = performance.now(); let result = 'network';
    try {
      for (let hop = 0; hop < 4; hop++) {
        url = xuiTransportUrl(url, this.env); this.checkUpstream(url);
        let response: Response;
        const headers = new Headers(options.headers);
        if (context) { const cookies = originCookies(context, url); if (cookies) headers.set('Cookie', cookies); else headers.delete('Cookie'); }
        try { response = await fetch(url, { ...options, headers, redirect: 'manual', signal: options.signal ?? AbortSignal.timeout(10000) }); }
        catch (error) {
          const cause = error instanceof Error && error.cause && typeof error.cause === 'object' && 'code' in error.cause ? String(error.cause.code) : 'NETWORK';
          this.failure(kind, ['DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(cause) ? cause : 'NETWORK');
          throw new AppError(502, 'XUI_NETWORK', 'Não foi possível consultar a origem');
        }
        if (context) rememberOriginCookies(context, url, response.headers);
        const location = response.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(response.status) && location) { await response.body?.cancel(); url = new URL(location, url); continue; }
        result = `${Math.floor(response.status / 100)}xx`; if (!response.ok) this.failure(kind, String(response.status));
        return response;
      }
      this.failure(kind, 'REDIRECT'); throw new AppError(502, 'XUI_REDIRECT', 'Excesso de redirects na origem');
    } finally { this.metrics?.upstream.observe({ kind, result }, (performance.now() - start) / 1000); }
  }
  async playerApi(session: Pick<ClientSession, 'username' | 'password'>, action?: string, params: Record<string, string> = {}): Promise<unknown> {
    if (this.active >= 4) throw new AppError(503, 'XUI_BUSY', 'Origem ocupada; tente novamente');
    this.active++;
    try {
      const url = new URL('player_api.php', this.origin());
      url.searchParams.set('username', session.username); url.searchParams.set('password', session.password);
      if (action) url.searchParams.set('action', action);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await this.fetch(url);
      if (!response.ok) { await response.body?.cancel(); throw new AppError(response.status === 401 || response.status === 403 ? 401 : 502, 'XUI_API', 'Origem recusou a consulta'); }
      try { return JSON.parse(await readBounded(response, 8 * 1024 * 1024)) as unknown; }
      catch (error) { if (error instanceof AppError) throw error; throw new AppError(502, 'XUI_JSON', 'Formato da origem incompatível'); }
    } finally { this.active--; }
  }
  async login(input: { username: string; password: string }) {
    const parsed = accountDto.safeParse(await this.playerApi(input));
    if (!parsed.success || String(parsed.data.user_info.auth) !== '1' || (parsed.data.user_info.status && parsed.data.user_info.status.toLowerCase() !== 'active')) throw new AppError(401, 'LINE_DENIED', 'Usuário ou senha inválidos');
    const info = parsed.data.user_info;
    const expiresAt = Math.min(Date.now() + this.env.CLIENT_SESSION_TTL_SECONDS * 1000, info.exp_date ? Number(info.exp_date) * 1000 : Infinity);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new AppError(401, 'LINE_EXPIRED', 'Linha expirada');
    const token = randomBytes(32).toString('hex');
    const session: ClientSession = { ...input, accountId: createHmac('sha256', this.env.JWT_SECRET).update(`${this.origin().href}:${input.username}`).digest('hex'), expiresAt, maxConnections: Math.max(1, Number(info.max_connections) || 1), validatedAt: Date.now() };
    await this.redis.set(`highpass:client:${digest(token)}`, encrypt(JSON.stringify(session), this.env.CONFIG_ENCRYPTION_KEY), 'EX', Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)));
    return { token, account: this.account(session) };
  }
  async session(token: string): Promise<ClientSession> { return this.sessionByHash(digest(token)); }
  async sessionByHash(hash: string): Promise<ClientSession> {
    const raw = await this.redis.get(`highpass:client:${hash}`);
    if (!raw) throw new AppError(401, 'SESSION_EXPIRED', 'Entre novamente');
    const session = sessionDto.parse(JSON.parse(decrypt(raw, this.env.CONFIG_ENCRYPTION_KEY)) as unknown);
    if (session.expiresAt <= Date.now()) throw new AppError(401, 'SESSION_EXPIRED', 'Entre novamente');
    if (Date.now() - session.validatedAt > 300000) {
      const pending = this.validations.get(hash);
      if (pending) return pending;
      const validation = this.revalidate(hash, session).finally(() => this.validations.delete(hash));
      this.validations.set(hash, validation);
      return validation;
    }
    return session;
  }
  private async revalidate(hash: string, session: ClientSession): Promise<ClientSession> {
    const parsed = accountDto.safeParse(await this.playerApi(session));
    if (!parsed.success || String(parsed.data.user_info.auth) !== '1' || (parsed.data.user_info.status && parsed.data.user_info.status.toLowerCase() !== 'active')) {
      await this.redis.del(`highpass:client:${hash}`); throw new AppError(401, 'LINE_REVOKED', 'Linha não autorizada; entre novamente');
    }
    const expiration = parsed.data.user_info.exp_date ? Number(parsed.data.user_info.exp_date) * 1000 : session.expiresAt;
    const next = { ...session, expiresAt: Math.min(session.expiresAt, expiration), maxConnections: Math.max(1, Number(parsed.data.user_info.max_connections) || 1), validatedAt: Date.now() };
    if (!Number.isFinite(next.expiresAt) || next.expiresAt <= Date.now()) { await this.redis.del(`highpass:client:${hash}`); throw new AppError(401, 'LINE_EXPIRED', 'Linha expirada'); }
    const updated = await this.redis.set(`highpass:client:${hash}`, encrypt(JSON.stringify(next), this.env.CONFIG_ENCRYPTION_KEY), 'EX', Math.max(1, Math.floor((next.expiresAt - Date.now()) / 1000)), 'XX');
    if (!updated) throw new AppError(401, 'SESSION_EXPIRED', 'Sessão encerrada');
    return next;
  }
  account(session: ClientSession) { return { username: session.username, accountId: session.accountId, expiresAt: session.expiresAt, maxConnections: session.maxConnections, p2pRequired: this.env.P2P_DELIVERY_ENABLED }; }
  async logout(token: string) {
    const hash = digest(token);
    await this.redis.eval("local ids=redis.call('ZRANGE',KEYS[2],0,-1); for _,id in ipairs(ids) do redis.call('DEL','highpass:media:'..id) end; redis.call('DEL',KEYS[1],KEYS[2]); return 1", 2, `highpass:client:${hash}`, `highpass:media-session:${hash}`);
  }
  async catalog(session: ClientSession, kind: ContentKind): Promise<CatalogItem[]> {
    const key = `${session.accountId}:${kind}`; const cached = this.catalogs.get(key);
    if (cached && cached.expires > Date.now()) return cached.items;
    const action = { live: 'get_live_streams', movie: 'get_vod_streams', series: 'get_series' }[kind];
    const result = await this.playerApi(session, action);
    if (!Array.isArray(result)) throw new AppError(502, 'CATALOG_FORMAT', 'Catálogo da origem incompatível');
    const items = result.slice(0, 30000).map((raw) => {
      const row = object(raw);
      return { id: string(kind === 'series' ? row.series_id : row.stream_id), name: string(row.name, 'Sem título').slice(0, 200), categoryId: string(row.category_id), image: string(row.stream_icon ?? row.cover), kind, extension: safeExtension(row.container_extension) };
    }).filter((item) => /^\d+$/.test(item.id));
    if (this.catalogs.size >= 8) { const oldest = this.catalogs.keys().next().value; if (oldest) this.catalogs.delete(oldest); }
    this.catalogs.set(key, { expires: Date.now() + 30000, items });
    return items;
  }
  async categories(session: ClientSession, kind: ContentKind) {
    const result = await this.playerApi(session, { live: 'get_live_categories', movie: 'get_vod_categories', series: 'get_series_categories' }[kind]);
    return Array.isArray(result) ? result.slice(0, 3000).map((raw) => { const row = object(raw); return { id: string(row.category_id), name: string(row.category_name) }; }) : [];
  }
  async episodes(session: ClientSession, id: string) {
    const allowed = await this.catalog(session, 'series');
    if (!allowed.some((item) => item.id === id)) throw new AppError(404, 'SERIES_NOT_FOUND', 'Série indisponível');
    const result = object(await this.playerApi(session, 'get_series_info', { series_id: id }));
    return Object.entries(object(result.episodes)).flatMap(([season, values]) => Array.isArray(values) ? values.map((raw) => { const row = object(raw); return { id: string(row.id), name: string(row.title, `Episódio ${string(row.episode_num)}`), season, extension: safeExtension(row.container_extension) }; }) : []).filter((item) => /^\d+$/.test(item.id)).slice(0, 10000);
  }
  async epg(session: ClientSession, id: string) {
    if (!(await this.catalog(session, 'live')).some((item) => item.id === id)) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Canal indisponível');
    const result = object(await this.playerApi(session, 'get_short_epg', { stream_id: id, limit: '8' }));
    return Array.isArray(result.epg_listings) ? result.epg_listings.slice(0, 8).map((raw) => { const row = object(raw); return { title: Buffer.from(string(row.title), 'base64').toString('utf8'), description: Buffer.from(string(row.description), 'base64').toString('utf8'), start: string(row.start), end: string(row.end) }; }) : [];
  }
  async playback(token: string, kind: 'live' | 'movie' | 'episode', id: string, seriesId?: string, relay = false, transport?: 'http' | 'p2p') {
    const session = await this.session(token);
    let extension = 'm3u8';
    if (kind === 'episode') {
      if (!seriesId) throw new AppError(400, 'SERIES_REQUIRED', 'Informe a série');
      const item = (await this.episodes(session, seriesId)).find((episode) => episode.id === id);
      if (!item) throw new AppError(404, 'EPISODE_NOT_FOUND', 'Episódio indisponível'); extension = item.extension;
    } else {
      const item = (await this.catalog(session, kind)).find((entry) => entry.id === id);
      if (!item) throw new AppError(404, 'CONTENT_NOT_FOUND', 'Conteúdo indisponível'); if (kind === 'movie') extension = item.extension;
    }
    const grantId = randomBytes(32).toString('hex');
    const grant: MediaGrant = { accountId: session.accountId, relay, transport, sessionHash: digest(token), kind, id, extension, swarmId: digest(`${this.origin().href}:${kind}:${id}`), expiresAt: session.expiresAt };
    const ttl = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000)); const grantHash = digest(grantId);
    const created = await this.redis.eval("if redis.call('EXISTS',KEYS[3])==0 then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); redis.call('ZADD',KEYS[2],ARGV[3],ARGV[4]); redis.call('EXPIRE',KEYS[2],ARGV[2]); local excess=redis.call('ZCARD',KEYS[2])-4; if excess>0 then local ids=redis.call('ZRANGE',KEYS[2],0,excess-1); for _,id in ipairs(ids) do redis.call('DEL','highpass:media:'..id); redis.call('ZREM',KEYS[2],id) end end; return 1", 3, `highpass:media:${grantHash}`, `highpass:media-session:${grant.sessionHash}`, `highpass:client:${grant.sessionHash}`, JSON.stringify(grant), ttl, Date.now(), grantHash);
    if (created !== 1) throw new AppError(401, 'SESSION_EXPIRED', 'Sessão encerrada');
    return this.descriptor(grantId);
  }
  async descriptor(grantId: string) {
    const grant = await this.grant(grantId); const session = await this.sessionByHash(grant.sessionHash);
    const folder = grant.kind === 'episode' ? 'series' : grant.kind === 'movie' ? 'movie' : 'live';
    const url = new URL(`${folder}/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${grant.id}.${grant.extension}`, this.origin());
    const directUrl = this.resourceUrl(grantId, url, grant.extension === 'm3u8' ? 'playlist' : 'segment');
    const iceServers = [...this.env.RTC_ICE_SERVERS];
    if (this.env.TURN_URLS && this.env.TURN_SHARED_SECRET) {
      const username = `${Math.ceil(grant.expiresAt / 1000)}:${session.accountId.slice(0, 16)}`;
      iceServers.push({ urls: this.env.TURN_URLS.split(',').map((value) => value.trim()).filter(Boolean), username, credential: createHmac('sha1', this.env.TURN_SHARED_SECRET).update(username).digest('base64') });
    }
    return { transport: grant.transport, url: grant.kind !== 'live' && grant.extension !== 'm3u8' ? `/api/iptv/vod/${grantId}/index.m3u8` : directUrl, directUrl, sourceFormat: grant.extension, telemetryPath: `/api/iptv/telemetry/${grantId}`, statsPath: `/api/iptv/traffic/${grantId}`, trackerPath: `/api/iptv/tracker/${grantId}`, swarmId: grant.swarmId, expiresAt: grant.expiresAt, isLive: grant.kind === 'live', isHls: true, iceServers, config: await this.configuration(), ...((grant.transport === 'p2p' || (grant.transport !== 'http' && this.env.P2P_DELIVERY_ENABLED)) ? { delivery: { mode: grant.transport === 'p2p' ? 'p2p-only' as const : 'p2p-first' as const, seedPath: `/api/iptv/seed/${grantId}`, segmentTimeoutMs: this.env.P2P_SEGMENT_TIMEOUT_MS, recoveryMs: 5000 } } : {}) };
  }
  isRelayRequest(request: { headers: Record<string, unknown>; raw: { socket: { remoteAddress: string | undefined } } }) {
    return request.headers['x-highpass-relay'] === this.relaySecret && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.raw.socket.remoteAddress ?? '');
  }
  isSeedRequest(request: Parameters<IptvService['isRelayRequest']>[0]) { return this.isRelayRequest(request) && request.headers['x-highpass-seed'] === '1'; }
  async recordHttp(grant: string, bytes: number) { if (bytes > 0) await this.redis.multi().hincrby(`highpass:traffic:${digest(grant)}`, 'httpDownloaded', bytes).expire(`highpass:traffic:${digest(grant)}`, 86400).exec(); }
  async traffic(grant: string) { const httpDownloaded = Number(await this.redis.hget(`highpass:traffic:${digest(grant)}`, 'httpDownloaded')) || 0; return { httpDownloaded, p2pDownloaded: 0, p2pUploaded: 0, peers: 0, totalDownloaded: httpDownloaded, httpPercentage: httpDownloaded ? 100 : 0, p2pPercentage: 0, transport: 'http', scope: 'engine-to-client' }; }
  resourceUrl(grantId: string, url: URL, kind: 'playlist' | 'segment' | 'key' = 'playlist') {
    url = xuiTransportUrl(url, this.env);
    this.checkUpstream(url);
    const sealed = encryptResource(JSON.stringify({ grantId, url: url.href, kind }), this.env.CONFIG_ENCRYPTION_KEY, grantId);
    return `/api/iptv/media/${grantId}/${sealed}`;
  }
  async grant(id: string): Promise<MediaGrant> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new AppError(401, 'MEDIA_GRANT', 'Acesso à mídia inválido');
    const raw = await this.redis.get(`highpass:media:${digest(id)}`);
    if (!raw) throw new AppError(401, 'MEDIA_GRANT', 'Acesso à mídia expirado');
    const grant = mediaGrantDto.parse(JSON.parse(raw) as unknown);
    await this.sessionByHash(grant.sessionHash);
    return grant;
  }
  resourceKind(grantId: string, sealed: string): string {
    try { const value = object(JSON.parse(decryptResource(sealed, this.env.CONFIG_ENCRYPTION_KEY, grantId)) as unknown); return typeof value.kind === 'string' ? value.kind : value.alias ? 'segment' : 'playlist'; }
    catch { throw new AppError(400, 'MEDIA_RESOURCE', 'Recurso de mídia inválido'); }
  }
  async resource(grantId: string, sealed: string): Promise<URL> {
    try {
      const parsed = object(JSON.parse(decryptResource(sealed, this.env.CONFIG_ENCRYPTION_KEY, grantId)) as unknown);
      if (parsed.grantId !== grantId) throw new Error('Grant diferente');
      let value = parsed.url;
      if (typeof parsed.alias === 'string' && /^[a-f0-9]{64}$/.test(parsed.alias)) {
        const saved = await this.redis.get(`highpass:hls:${digest(grantId)}:${parsed.alias}`);
        if (!saved) throw new AppError(404, 'SEGMENT_EXPIRED', 'Segmento fora da janela ao vivo');
        value = decrypt(saved, this.env.CONFIG_ENCRYPTION_KEY);
      }
      if (typeof value !== 'string') throw new Error('Recurso inválido');
      const url = xuiTransportUrl(new URL(value), this.env); this.checkUpstream(url); return url;
    } catch (error) { if (error instanceof AppError && error.code === 'SEGMENT_EXPIRED') throw error; throw new AppError(400, 'MEDIA_RESOURCE', 'Recurso de mídia inválido'); }
  }
  async rewriteManifest(text: string, base: URL, grantId: string, playlistIdentity: string): Promise<string> {
    const local = (value: string, kind: 'playlist' | 'segment' | 'key' = 'playlist') => this.resourceUrl(grantId, new URL(value, base), kind);
    const lines = text.split(/\r?\n/);
    let sequence = Number(lines.find((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))?.split(':')[1] ?? 0);
    const discontinuity = lines.find((line) => line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) ?? '';
    const pipeline = this.redis.pipeline(); let media = false; let count = 0;
    const result = lines.map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith('#EXTINF:')) media = true;
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${local(uri, /^#EXT-X-(SESSION-)?KEY:/.test(line) ? 'key' : /^#EXT-X-(MAP|PART|PRELOAD-HINT):/.test(line) ? 'segment' : 'playlist')}"`);
      if (!media) return local(line.trim());
      media = false;
      if (++count > 2000 || !Number.isSafeInteger(sequence)) throw new AppError(502, 'HLS_SEGMENTS', 'Playlist excedeu o limite de segmentos');
      const url = xuiTransportUrl(new URL(line.trim(), base), this.env); this.checkUpstream(url);
      // A assinatura XUI pode mudar sem mudar os bytes/sn. O identificador local
      // fica estável e somente o destino cifrado expira/é atualizado no Redis.
      const alias = digest(`${playlistIdentity}:${discontinuity}:${sequence++}`);
      pipeline.set(`highpass:hls:${digest(grantId)}:${alias}`, encrypt(url.href, this.env.CONFIG_ENCRYPTION_KEY), 'EX', 600);
      const sealed = encryptResource(JSON.stringify({ grantId, alias, kind: 'segment' }), this.env.CONFIG_ENCRYPTION_KEY, grantId);
      return `/api/iptv/media/${grantId}/${sealed}`;
    }).join('\n');
    if (count) { const replies = await pipeline.exec(); if (!replies || replies.some(([error]) => error)) throw new AppError(503, 'HLS_CACHE', 'Mapeamento de segmentos indisponível'); }
    return result;
  }
}
