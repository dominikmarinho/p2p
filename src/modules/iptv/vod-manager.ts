import type { RokuRelay } from './roku-relay.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { IptvService } from './iptv.service.js';
import { clientToken } from './iptv.routes.js';
import { digest } from '../../lib/secrets.js';
import { AppError } from '../../lib/errors.js';

interface Job { id: string; key: string; grant: string; grants: Set<string>; folder: string; process: ChildProcess; lastUsed: number; failed: boolean; failedAt: number; complete: boolean }
export class VodManager {
  private readonly jobs = new Map<string, Job>();
  private readonly pending = new Map<string, Promise<Job>>();
  private closed = false;
  private initialized: Promise<void> | undefined;
  private readonly timer: NodeJS.Timeout;
  constructor(private readonly service: IptvService, private readonly relay: RokuRelay) {
    this.timer = setInterval(() => { void this.collect().catch(() => undefined); }, 30000); this.timer.unref();
  }
  async close() { this.closed = true; clearInterval(this.timer); await Promise.allSettled([...this.pending.values()]); await Promise.allSettled([...this.jobs.values()].map((job) => this.remove(job))); }
  private async remove(job: Job) { this.jobs.delete(job.key); job.process.kill('SIGKILL'); await rm(job.folder, { recursive: true, force: true }); }
  private async collect() {
    for (const job of this.jobs.values()) {
      let bytes = 0;
      for (const file of await readdir(job.folder)) bytes += (await stat(resolve(job.folder, file))).size;
      if (Date.now() - job.lastUsed > 1800000 || bytes > 2 * 1024 * 1024 * 1024) await this.remove(job);
    }
  }
  private async start(grant: string, base: string): Promise<Job> {
    if (this.jobs.size + this.pending.size >= 4) throw new AppError(503, 'VOD_BUSY', 'Preparação de filmes ocupada; tente novamente');
    const permission = await this.service.grant(grant);
    const root = this.service.env.VOD_CACHE_DIR || resolve(tmpdir(), 'highpass-vod'); await mkdir(root, { recursive: true });
    this.initialized ??= (async () => { for (const name of await readdir(root)) if (/^vod-[a-zA-Z0-9]+$/.test(name)) await rm(resolve(root, name), { recursive: true, force: true }); })();
    await this.initialized;
    const folder = await mkdtemp(resolve(root, 'vod-')); const id = randomBytes(32).toString('hex');
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-rw_timeout', '15000000', '-i', `${base}/internal/vod-source/${id}`, '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-sn', '-dn', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file', '-hls_segment_filename', resolve(folder, 'chunk%06d.ts'), resolve(folder, 'index.m3u8')], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.resume();
    const job: Job = { id, key: permission.swarmId, grant, grants: new Set([grant]), folder, process: child, lastUsed: Date.now(), failed: false, failedAt: 0, complete: false };
    child.on('error', () => { job.failed = true; job.failedAt = Date.now(); }); child.on('exit', (code) => { job.failed = code !== 0; job.failedAt = code === 0 ? 0 : Date.now(); job.complete = code === 0; });
    this.jobs.set(permission.swarmId, job); return job;
  }
  private async job(grant: string, base: string) {
    if (this.closed) throw new AppError(503, 'VOD_CLOSED', 'Servidor em atualização');
    const permission = await this.service.grant(grant); const key = permission.swarmId;
    const existing = this.jobs.get(key);
    if (existing && !(existing.failed && Date.now() - existing.failedAt > 30000)) { existing.lastUsed = Date.now(); if (existing.grants.size < 256) existing.grants.add(grant); return existing; }
    if (existing) await this.remove(existing);
    let pending = this.pending.get(key);
    if (!pending) { pending = this.start(grant, base).finally(() => this.pending.delete(key)); this.pending.set(key, pending); }
    const job = await pending; if (job.grants.size < 256) job.grants.add(grant); return job;
  }
  routes(app: FastifyInstance) {
    app.get<{ Params: { job: string } }>('/internal/vod-source/:job', { config: { rateLimit: false, disableMetrics: true } }, async (request, reply) => {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.raw.socket.remoteAddress ?? '')) return reply.code(404).send();
      const job = [...this.jobs.values()].find((value) => value.id === request.params.job);
      if (!job) return reply.code(404).send();
      let source: URL | undefined;
      for (const candidate of job.grants) {
        try {
          const permission = await this.service.grant(candidate); const session = await this.service.sessionByHash(permission.sessionHash);
          source = new URL(`${permission.kind === 'episode' ? 'series' : 'movie'}/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${permission.id}.${permission.extension}`, this.service.origin()); break;
        } catch { job.grants.delete(candidate); }
      }
      if (!source) throw new AppError(401, 'VOD_SESSION', 'Nenhuma sessão ativa para este conteúdo');
      const abort = new AbortController(); reply.raw.on('close', () => abort.abort());
      const response = await this.service.fetch(source, { headers: request.headers.range ? { Range: request.headers.range } : {}, signal: abort.signal });
      for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const value = response.headers.get(header); if (value) reply.header(header, value); }
      if (!response.body) return reply.code(502).send();
      async function* chunks() { const reader = response.body!.getReader(); try { while (true) { const next = await reader.read(); if (next.done) break; yield Buffer.from(next.value); } } finally { await reader.cancel().catch(() => undefined); } }
      return reply.code(response.status).send(Readable.from(chunks()));
    });
    app.get<{ Params: { grant: string; file: string } }>('/api/iptv/vod/:grant/:file', { config: { rateLimit: false, disableMetrics: true } }, async (request, reply) => {
      const permission = await this.service.grant(request.params.grant);
      if (digest(clientToken(request)) !== permission.sessionHash) throw new AppError(401, 'MEDIA_OWNER', 'Mídia pertence a outra sessão');
      if (permission.kind === 'live' || !/^(index\.m3u8|chunk\d{6}\.ts)$/.test(request.params.file)) return reply.code(404).send();
      const address = app.server.address(); if (address === null || typeof address === 'string') throw new AppError(503, 'VOD_ADDRESS', 'Servidor indisponível');
      reply.raw.setTimeout(30000);
      const base = `http://127.0.0.1:${address.port}`; const gateway = permission.relay && !this.service.isRelayRequest(request);
      if (gateway && request.params.file !== 'index.m3u8') { const data = await this.relay.load(request.params.grant, request.url, base); if (data) return reply.type('video/mp2t').send(data); }
      const job = await this.job(request.params.grant, base);
      const file = resolve(job.folder, request.params.file); const deadline = Date.now() + 12000;
      while (true) {
        if (job.failed) throw new AppError(502, 'VOD_REMUX', 'Formato VOD incompatível com remux HLS');
        try { if ((await stat(file)).size > 0) break; } catch { /* O FFmpeg publica o arquivo atomicamente ao concluir o segmento. */ }
        if (Date.now() >= deadline) throw new AppError(503, 'VOD_PREPARING', 'Conteúdo em preparação; tente novamente');
        await new Promise<void>((done) => setTimeout(done, 100));
      }
      reply.header('Cache-Control', 'no-store');
      if (request.params.file === 'index.m3u8') {
        if (gateway) await this.relay.resume(request.params.grant);
        const manifest = await readFile(file, 'utf8');
        const rewritten = manifest.replace(/^(chunk\d{6}\.ts)$/gm, `/api/iptv/vod/${request.params.grant}/$1`);
        if (gateway) await this.relay.observe(request.params.grant, clientToken(request), base, request.url, rewritten);
        return reply.type('application/vnd.apple.mpegurl').send(rewritten);
      }
      reply.header('Content-Length', (await stat(file)).size);
      const service = this.service; const relay = this.relay; const ownerGrant = request.params.grant; const internal = service.isRelayRequest(request);
      async function* chunks() {
        let bytes = 0;
        try { for await (const raw of createReadStream(file)) { const value: unknown = raw; const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); bytes += chunk.length; yield chunk; } }
        finally { if (!internal) { await service.recordHttp(ownerGrant, bytes); if (gateway) relay.http(ownerGrant, bytes); } }
      }
      return reply.type('video/mp2t').send(Readable.from(chunks()));
    });
  }
}
