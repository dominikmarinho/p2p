import type { RokuRelay } from './roku-relay.js';
import type { SeedManager } from './seed-manager.js';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { contentKindDto, lineCredentialsDto } from './iptv.dto.js';
import { type IptvService, readBounded } from './iptv.service.js';
import { digest } from '../../lib/secrets.js';

async function* bodyChunks(body: ReadableStream<Uint8Array>, record: (bytes: number) => Promise<void>): AsyncGenerator<Buffer> {
  const reader = body.getReader(); let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) return; size += next.value.byteLength; yield Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength); if (size >= 1048576) { await record(size); size = 0; } } }
  finally { await record(size); await reader.cancel().catch(() => undefined); }
}

export function clientToken(request: FastifyRequest): string {
  const bearer = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  const cookie = request.headers.cookie?.match(/(?:^|;\s*)HP_SESSION=([a-f0-9]{64})(?:;|$)/)?.[1];
  const token = bearer ?? cookie;
  if (!token) throw new AppError(401, 'CLIENT_AUTH', 'Entre com usuário e senha');
  return token;
}

export function iptvRoutes(app: FastifyInstance, service: IptvService, relay: RokuRelay, seeds: SeedManager): void {
  const router = app.withTypeProvider<ZodTypeProvider>();
  router.addHook('onRequest', (request, _reply, done) => {
    const origin = request.headers.origin;
    if (!origin) { done(); return; }
    const allowed = service.isRelayRequest(request) || origin === new URL(service.env.PUBLIC_ENGINE_URL).origin || (service.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2):\d+$/.test(origin));
    if (!allowed) throw new AppError(403, 'ORIGIN_DENIED', 'Origem não permitida');
    done();
  });
  router.addHook('onSend', async (_request, reply, payload) => { if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store'); return payload; });
  seeds.routes(app);
  router.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: lineCredentialsDto } }, async (request, reply) => {
    const result = await service.login(request.body);
    const secure = service.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header('Set-Cookie', `HP_SESSION=${result.token}; HttpOnly; SameSite=Strict; Path=/api/iptv; Max-Age=${Math.floor((result.account.expiresAt - Date.now()) / 1000)}${secure}`);
    return result;
  });
  router.get('/account', async (request) => service.account(await service.session(clientToken(request))));
  router.post('/logout', async (request, reply) => {
    await service.logout(clientToken(request));
    reply.header('Set-Cookie', `HP_SESSION=; HttpOnly; SameSite=Strict; Path=/api/iptv; Max-Age=0${service.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return reply.code(204).send();
  });
  router.get('/artwork/:kind/:id', { config: { rateLimit: { max: 240, timeWindow: '1 minute', keyGenerator: (request) => `artwork:${digest(clientToken(request))}` } }, schema: { params: z.object({ kind: contentKindDto, id: z.string().regex(/^\d+$/) }) } }, async (request, reply) => {
    const session = await service.session(clientToken(request));
    const item = (await service.catalog(session, request.params.kind)).find((entry) => entry.id === request.params.id);
    if (!item?.image) throw new AppError(404, 'ARTWORK_NOT_FOUND', 'Capa indisponível');
    const upstream = new URL(item.image, service.origin()); service.checkUpstream(upstream);
    const response = await service.fetch(upstream, { signal: AbortSignal.timeout(5000) });
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mime)) { await response.body?.cancel(); throw new AppError(502, 'ARTWORK_FORMAT', 'Capa incompatível'); }
    const reader = response.body?.getReader(); if (!reader) throw new AppError(502, 'ARTWORK_EMPTY', 'Capa indisponível');
    const parts: Buffer[] = []; let size = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 2 * 1024 * 1024) throw new AppError(502, 'ARTWORK_SIZE', 'Capa acima do limite'); parts.push(Buffer.from(next.value)); } }
    finally { await reader.cancel().catch(() => undefined); }
    return reply.header('Cache-Control', 'private, max-age=300').type(mime).send(Buffer.concat(parts));
  });
  router.get('/catalog', { schema: { querystring: z.object({ kind: contentKindDto, category: z.string().max(64).optional(), search: z.string().max(100).optional(), offset: z.coerce.number().int().min(0).max(30000).default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }) } }, async (request) => {
    const session = await service.session(clientToken(request)); const query = request.query;
    let items = await service.catalog(session, query.kind);
    if (query.category) items = items.filter((item) => item.categoryId === query.category);
    if (query.search) { const search = query.search.toLocaleLowerCase(); items = items.filter((item) => item.name.toLocaleLowerCase().includes(search)); }
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length };
  });
  router.get('/categories', { schema: { querystring: z.object({ kind: contentKindDto }) } }, async (request) => service.categories(await service.session(clientToken(request)), request.query.kind));
  router.get('/series/:id', { schema: { params: z.object({ id: z.string().regex(/^\d+$/) }) } }, async (request) => service.episodes(await service.session(clientToken(request)), request.params.id));
  router.get('/epg/:id', { schema: { params: z.object({ id: z.string().regex(/^\d+$/) }) } }, async (request) => service.epg(await service.session(clientToken(request)), request.params.id));
  router.post('/playback', { schema: { body: z.object({ kind: z.enum(['live', 'movie', 'episode']), id: z.string().regex(/^\d+$/), seriesId: z.string().regex(/^\d+$/).optional(), client: z.enum(['web', 'android', 'roku']).optional(), transport: z.enum(['http', 'p2p']).optional() }).strict() } }, async (request) => {
    const token = clientToken(request); const playback = await service.playback(token, request.body.kind, request.body.id, request.body.seriesId, request.body.client === 'roku', request.body.transport);
    if (playback.delivery) {
      const id = playback.delivery.seedPath.split('/').at(-1);
      if (id) void seeds.prepare(app, token, id).catch(() => undefined);
    }
    return playback;
  });

  router.get<{ Params: { grant: string } }>('/traffic/:grant', async (request) => {
    const permission = await service.grant(request.params.grant);
    if (digest(clientToken(request)) !== permission.sessionHash) throw new AppError(401, 'MEDIA_OWNER', 'Sessão inválida');
    return relay.stats(request.params.grant) ?? service.traffic(request.params.grant);
  });

  router.get('/media/:grant/:resource', { config: { rateLimit: false, disableMetrics: true }, schema: { params: z.object({ grant: z.string().regex(/^[a-f0-9]{64}$/), resource: z.string().regex(/^[\w.-]{20,4096}$/) }) } }, async (request, reply) => {
    const { grant, resource } = request.params;
    const permission = await service.grant(grant);
    if (digest(clientToken(request)) !== permission.sessionHash) throw new AppError(401, 'MEDIA_OWNER', 'Mídia pertence a outra sessão');
    if (permission.transport === 'p2p' && !service.isRelayRequest(request) && service.resourceKind(grant, resource) === 'segment') throw new AppError(403, 'P2P_ONLY', 'Este cliente recebe vídeo exclusivamente pela rede P2P');
    const upstream = await service.resource(grant, resource);
    const address = app.server.address(); const base = address && typeof address !== 'string' ? `http://127.0.0.1:${address.port}` : '';
    const gateway = permission.relay && !service.isRelayRequest(request);
    if (gateway) reply.raw.setTimeout(30000);
    if (gateway && permission.kind !== 'live' && permission.extension !== 'm3u8') await relay.httpOnly(grant);
    if (gateway && !upstream.pathname.endsWith('.m3u8') && !request.headers.range) {
      const buffer = await relay.load(grant, request.url, base);
      if (buffer) return reply.type('video/mp2t').send(buffer);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); timeout.unref();
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) controller.abort(); });
    let response: Response;
    try { const options = { headers: request.headers.range ? { Range: request.headers.range } : {}, signal: controller.signal }; response = permission.kind === 'live' || upstream.pathname.endsWith('.m3u8') ? await service.fetchMedia(upstream, options, `${permission.accountId ?? permission.sessionHash}:${permission.swarmId}`) : await service.fetch(upstream, options); }
    finally { clearTimeout(timeout); }
    if (!response.ok) { await response.body?.cancel(); throw new AppError(response.status === 404 ? 404 : 502, 'MEDIA_UPSTREAM', 'Conteúdo temporariamente indisponível'); }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    if (/mpegurl/i.test(contentType) || new URL(response.url || upstream.href).pathname.endsWith('.m3u8')) {
      const text = await readBounded(response, 1024 * 1024);
      if (!text.trimStart().startsWith('#EXTM3U')) throw new AppError(502, 'HLS_FORMAT', 'A origem não retornou uma playlist HLS');
      const manifest = await service.rewriteManifest(text, new URL(response.url || upstream.href), grant, resource);
      if (gateway) await relay.observe(grant, clientToken(request), base, request.url, manifest);
      return reply.type('application/vnd.apple.mpegurl').send(manifest);
    }
    if (permission.transport === 'p2p' && !service.isRelayRequest(request) && service.resourceKind(grant, resource) !== 'key') { await response.body?.cancel(); throw new AppError(403, 'P2P_ONLY', 'Este cliente recebe vídeo exclusivamente pela rede P2P'); }
    for (const name of ['content-length', 'content-range', 'accept-ranges']) { const value = response.headers.get(name); if (value) reply.header(name, value); }
    if (!response.body) return reply.code(502).send();
    return reply.code(response.status).type(contentType).send(Readable.from(bodyChunks(response.body, async (bytes) => { if (!service.isRelayRequest(request)) { await service.recordHttp(grant, bytes); if (gateway) relay.http(grant, bytes); } })));
  });
}
