import { digest } from '../../lib/secrets.js';
import { AppError } from '../../lib/errors.js';

interface Cookie { value: string; host: string; path: string; secure: boolean; expires: number }
export interface OriginContext { cookies: Map<string, Cookie> }
interface Session extends OriginContext { touched: number; playlists: Map<string, string>; failures: Map<string, { attempts: number; retryAt: number }> }
interface Snapshot { bytes: Buffer; status: number; headers: Headers; url: string; expires: number }
interface Loaded { snapshot?: Snapshot; response?: Response; claimed: boolean }
type Fetcher = (url: URL, init: RequestInit, context: OriginContext) => Promise<Response>;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY = 16 * 1024 * 1024;
const MAX_PLAYLIST = 1024 * 1024;
const IDLE_MS = 90000;

/** Cookies are restricted to the exact permitted upstream host and their path. */
export function originCookies(context: OriginContext, url: URL): string {
  const values: string[] = [];
  for (const [key, cookie] of context.cookies) {
    if (cookie.expires <= Date.now()) { context.cookies.delete(key); continue; }
    if (cookie.host === url.host && (!cookie.secure || url.protocol === 'https:') && (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/'))) values.push(cookie.value);
  }
  return values.join('; ');
}
export function rememberOriginCookies(context: OriginContext, url: URL, headers: Headers) {
  for (const raw of headers.getSetCookie()) {
    if (raw.length > 8192) continue;
    const [pair, ...parts] = raw.split(';'); if (!pair || !/^[!#$%&'*+.^_`|~\w-]+=/.test(pair)) continue;
    const attributes = new Map(parts.map((value) => { const separator = value.indexOf('='); return [value.slice(0, separator < 0 ? undefined : separator).trim().toLowerCase(), separator < 0 ? '' : value.slice(separator + 1).trim()]; }));
    const domain = attributes.get('domain')?.replace(/^\./, '').toLowerCase(); if (domain && domain !== url.hostname.toLowerCase()) continue;
    const path = attributes.get('path')?.startsWith('/') ? attributes.get('path') ?? '/' : url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) || '/';
    const maxAge = attributes.get('max-age'); const expiration = attributes.get('expires');
    const expires = maxAge !== undefined && /^-?\d+$/.test(maxAge) ? Date.now() + Number(maxAge) * 1000 : expiration && Number.isFinite(Date.parse(expiration)) ? Date.parse(expiration) : Infinity;
    const key = `${url.host}:${path}:${pair.split('=')[0]}`;
    if (expires <= Date.now()) context.cookies.delete(key);
    else { if (context.cookies.size >= 16 && !context.cookies.has(key)) { const oldest = context.cookies.keys().next().value; if (oldest) context.cookies.delete(oldest); } context.cookies.set(key, { value: pair.trim(), host: url.host, path, secure: attributes.has('secure'), expires }); }
  }
}

/** One XUI HLS session per account/content, shared by seed and HTTP fallback. */
export class OriginMedia {
  private readonly sessions = new Map<string, Session>();
  private readonly cache = new Map<string, Snapshot>();
  private readonly pending = new Map<string, Promise<Loaded>>();
  private readonly controllers = new Set<AbortController>();
  private bytes = 0;
  private closed = false;
  private readonly totals = { playlistOpens: 0, playlistReloads: 0, mediaRequests: 0, cacheHits: 0, coalesced: 0, bufferedOriginBytes: 0 };
  constructor(private readonly request: Fetcher) {}
  diagnostics() { this.prune(); return { ...this.totals, sessions: this.sessions.size, cachedEntries: this.cache.size, cachedBytes: this.bytes, pending: this.pending.size }; }
  close() { this.closed = true; for (const controller of this.controllers) controller.abort(); this.controllers.clear(); this.sessions.clear(); this.cache.clear(); this.bytes = 0; }
  private prune() {
    const now = Date.now();
    for (const [key, session] of this.sessions) if (now - session.touched > IDLE_MS) this.sessions.delete(key);
    for (const [key, entry] of this.cache) if (entry.expires <= now) { this.cache.delete(key); this.bytes -= entry.bytes.length; }
  }
  private session(scope: string) {
    this.prune(); let session = this.sessions.get(scope);
    if (!session) { if (this.sessions.size >= 128) throw new AppError(503, 'MEDIA_CAPACITY', 'Origem ocupada; tente novamente'); session = { touched: Date.now(), cookies: new Map(), playlists: new Map(), failures: new Map() }; this.sessions.set(scope, session); }
    session.touched = Date.now(); return session;
  }
  private response(snapshot: Snapshot) {
    const body = snapshot.bytes.length ? new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(snapshot.bytes); controller.close(); } }) : null;
    const response = new Response(body, { status: snapshot.status, headers: snapshot.headers });
    Object.defineProperty(response, 'url', { value: snapshot.url }); return response;
  }
  async fetch(url: URL, init: RequestInit, scope: string): Promise<Response> {
    if (this.closed) throw new AppError(503, 'MEDIA_CLOSED', 'Origem em encerramento');
    const session = this.session(scope);
    // Whole files and byte ranges keep their original streaming/cancellation semantics.
    if (new Headers(init.headers).has('range')) return this.request(url, init, session);
    const key = digest(`${scope}:${url.href}`); const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) { this.totals.cacheHits++; return this.response(cached); }
    const failure = session.failures.get(url.href);
    if (failure && failure.retryAt > Date.now()) throw new AppError(503, 'MEDIA_RETRY', 'Origem em recuperação; tente novamente');
    let pending = this.pending.get(key);
    if (pending) this.totals.coalesced++;
    else { if (this.pending.size >= 8) throw new AppError(503, 'MEDIA_BUSY', 'Origem ocupada; tente novamente'); pending = this.load(url, init, session, key).finally(() => this.pending.delete(key)); this.pending.set(key, pending); }
    const loaded = await pending;
    if (loaded.snapshot) return this.response(loaded.snapshot);
    if (loaded.response && !loaded.claimed) { loaded.claimed = true; return loaded.response; }
    // Large or unbounded streams are not cloned/teed: each caller owns its stream.
    const direct = await this.load(url, init, session, key);
    return direct.snapshot ? this.response(direct.snapshot) : direct.response ?? new Response(null, { status: 502 });
  }
  private failed(session: Session, url: string) {
    const attempts = Math.min(4, (session.failures.get(url)?.attempts ?? 0) + 1);
    if (session.failures.size >= 64 && !session.failures.has(url)) { const oldest = session.failures.keys().next().value; if (oldest) session.failures.delete(oldest); }
    session.failures.set(url, { attempts, retryAt: Date.now() + Math.min(10000, 1000 * 2 ** attempts) });
  }
  private async load(original: URL, init: RequestInit, session: Session, key: string): Promise<Loaded> {
    const remembered = session.playlists.get(original.href);
    let target = remembered ? new URL(remembered) : original;
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10000); timeout.unref();
    const headers = new Headers(init.headers); headers.set('Accept-Encoding', 'identity');
    try {
      let countedOpen = false;
      if (remembered) this.totals.playlistReloads++;
      else if (original.pathname.endsWith('.m3u8')) { this.totals.playlistOpens++; countedOpen = true; }
      let response = await this.request(target, { ...init, headers, signal: controller.signal }, session);
      // Session tokens may expire at the source. Reopen only once, and share that
      // refresh across concurrent consumers through the same in-flight promise.
      if (remembered && [401, 403, 404, 410].includes(response.status)) { await response.body?.cancel(); session.playlists.delete(original.href); target = original; this.totals.playlistOpens++; countedOpen = true; response = await this.request(target, { ...init, headers, signal: controller.signal }, session); }
      const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.toLowerCase() ?? '';
      const playlist = Boolean(remembered) || /mpegurl/.test(mime) || original.pathname.endsWith('.m3u8');
      if (playlist && response.ok) {
        if (!remembered && !countedOpen) this.totals.playlistOpens++;
        if (session.playlists.size >= 16 && !session.playlists.has(original.href)) { const oldest = session.playlists.keys().next().value; if (oldest) session.playlists.delete(oldest); }
        session.playlists.set(original.href, response.url || target.href);
      } else if (!playlist) this.totals.mediaRequests++;
      if (!response.ok) { this.failed(session, original.href); await response.body?.cancel(); return { snapshot: { bytes: Buffer.alloc(0), status: response.status, headers: new Headers(), url: response.url || target.href, expires: Date.now() }, claimed: false }; }
      const lengthHeader = response.headers.get('content-length'); const length = lengthHeader === null ? undefined : Number(lengthHeader);
      if (!response.body || (!playlist && (length === undefined || !Number.isFinite(length) || length > MAX_ENTRY))) {
        // Keep cancellation connected to the original caller for uncached streams.
        if (init.signal?.aborted) controller.abort(); else init.signal?.addEventListener('abort', () => controller.abort(), { once: true, signal: controller.signal });
        session.failures.delete(original.href); return { response, claimed: false };
      }
      const limit = playlist ? MAX_PLAYLIST : MAX_ENTRY; const reader = response.body.getReader(); const parts: Buffer[] = []; let size = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) throw new AppError(502, 'MEDIA_SIZE', 'Recurso de mídia acima do limite'); parts.push(Buffer.from(next.value)); } }
      finally { await reader.cancel().catch(() => undefined); }
      const bytes = Buffer.concat(parts);
      if (playlist && !bytes.toString('utf8').trimStart().startsWith('#EXTM3U')) throw new AppError(502, 'HLS_FORMAT', 'A origem não retornou uma playlist HLS');
      session.failures.delete(original.href); const copiedHeaders = new Headers(response.headers); copiedHeaders.delete('content-encoding'); copiedHeaders.delete('set-cookie'); copiedHeaders.set('content-length', String(bytes.length));
      // Direct entry manifests can rotate signatures on every request. Only
      // briefly cache a resolved session playlist, never hide a fresh direct entry.
      const playlistTtl = original.pathname.endsWith('.m3u8') && (response.url || target.href) === original.href ? 0 : 500;
      const noCache = /\b(?:no-store|no-cache)\b/i.test(response.headers.get('cache-control') ?? '');
      const possibleKey = !playlist && mime === 'application/octet-stream' && bytes.length <= 64;
      const ttl = noCache || possibleKey ? 0 : playlist ? playlistTtl : 120000;
      const snapshot: Snapshot = { bytes, status: response.status, headers: copiedHeaders, url: response.url || target.href, expires: Date.now() + ttl };
      this.totals.bufferedOriginBytes += size;
      if (!this.closed && ttl > 0) { while (this.cache.size >= 256 || this.bytes + size > MAX_BYTES) { const oldest = this.cache.keys().next().value; if (!oldest) break; const previous = this.cache.get(oldest); this.cache.delete(oldest); this.bytes -= previous?.bytes.length ?? 0; } const previous = this.cache.get(key); if (previous) this.bytes -= previous.bytes.length; this.cache.set(key, snapshot); this.bytes += size; }
      return { snapshot, claimed: false };
    } catch (error) { this.failed(session, original.href); throw error; }
    finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
}
