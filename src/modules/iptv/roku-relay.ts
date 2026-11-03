import { logger } from '../../lib/logger.js';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { IptvService } from './iptv.service.js';

interface Traffic { httpDownloaded: number; p2pDownloaded: number; p2pUploaded: number; peers: number; totalDownloaded: number; httpPercentage: number; p2pPercentage: number }
interface Pending { chunks: Buffer[]; size: number; finish: (buffer: Buffer | null) => void }
interface Starting { promise: Promise<Relay | undefined>; cancelled: boolean; context?: BrowserContext }
interface Relay { context: BrowserContext; page: Page; lastUsed: number; stats: Traffic; pending: Map<string, Pending>; seed: boolean }
export class RokuRelay {
  private browser: Promise<Browser> | undefined;
  private readonly sessions = new Map<string, Relay>();
  private readonly starts = new Map<string, Starting>();
  private closed = false;
  private readonly timer: NodeJS.Timeout;
  constructor(private readonly service: IptvService) {
    this.timer = setInterval(() => { for (const [id, relay] of this.sessions) if (Date.now() - relay.lastUsed > 15000) void this.remove(id); }, 5000); this.timer.unref();
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    // Startup is bounded by launch/navigation timeouts and owns its context cleanup.
    await Promise.allSettled([...this.starts.keys()].map((id) => this.remove(id)));
    const browser = await this.browser?.catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await Promise.allSettled([...this.starts.values()].map((start) => start.promise));
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.remove(id)));
  }
  private async remove(id: string, expected?: Relay) {
    if (expected && this.sessions.get(id) !== expected) return;
    const starting = this.starts.get(id); if (starting) starting.cancelled = true;
    const relay = this.sessions.get(id); this.sessions.delete(id);
    if (relay) { for (const request of relay.pending.values()) request.finish(null); await relay.context.close().catch(() => undefined); }
    // Do not close a context while Playwright is registering exposed bindings.
    // Cooperative cancellation lets the in-flight protocol operation finish first.
    if (starting) await starting.promise.catch(() => undefined);
  }
  private ensure(id: string, token: string, base: string, seedGrant?: string) {
    const existing = this.sessions.get(id); if (existing) return Promise.resolve(existing);
    const pending = this.starts.get(id); if (pending) return pending.promise;
    if (this.closed || this.sessions.size + this.starts.size >= this.service.env.P2P_RELAY_MAX_SESSIONS + this.service.env.P2P_SEED_MAX_STREAMS) return Promise.resolve(undefined);
    if (!seedGrant && [...this.sessions.values()].filter((session) => !session.seed).length >= this.service.env.P2P_RELAY_MAX_SESSIONS) return Promise.resolve(undefined);
    const starting: Starting = { promise: Promise.resolve(undefined), cancelled: false };
    this.starts.set(id, starting);
    starting.promise = this.start(id, token, base, starting, seedGrant).finally(() => { if (this.starts.get(id) === starting) this.starts.delete(id); });
    return starting.promise;
  }
  private async start(id: string, token: string, base: string, starting: Starting, seedGrant?: string): Promise<Relay | undefined> {
    if (this.closed || starting.cancelled) return undefined;
    this.browser ??= chromium.launch({ ...(this.service.env.CHROMIUM_PATH ? { executablePath: this.service.env.CHROMIUM_PATH } : {}), headless: true, timeout: 10000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'] }).then((browser) => { browser.once('disconnected', () => { this.browser = undefined; }); return browser; }).catch((error: unknown) => { this.browser = undefined; throw error; });
    let context: BrowserContext | undefined;
    try {
      const browser = await this.browser; if (this.closed || starting.cancelled) return undefined;
      context = await browser.newContext({ bypassCSP: true, extraHTTPHeaders: { 'x-highpass-relay': this.service.relaySecret, ...(seedGrant ? { 'x-highpass-seed': '1' } : {}) } });
      starting.context = context; if (this.closed || starting.cancelled) { await context.close(); return undefined; }
      await context.addCookies([{ name: 'HP_SESSION', value: token, domain: '127.0.0.1', path: '/api/iptv', httpOnly: true, secure: false, sameSite: 'Strict' }]);
      const page = await context.newPage(); const pending = new Map<string, Pending>();
      const relay: Relay = { context, page, lastUsed: Date.now(), pending, seed: Boolean(seedGrant), stats: { httpDownloaded: 0, p2pDownloaded: 0, p2pUploaded: 0, peers: 0, totalDownloaded: 0, httpPercentage: 0, p2pPercentage: 0 } };
      page.once('close', () => { void this.remove(id, relay); });
      await page.exposeFunction('relayComplete', (request: string, chunk: string, done: boolean) => {
        const task = pending.get(request); if (!task) return; const data = Buffer.from(chunk, 'base64'); task.size += data.length;
        if (task.size > 16 * 1024 * 1024) { task.finish(null); return; } task.chunks.push(data); if (done) task.finish(Buffer.concat(task.chunks));
      });
      await page.exposeFunction('relayFallback', (request: string) => pending.get(request)?.finish(null));
      await page.exposeFunction('relayStats', (raw: string) => { if (raw.length > 4096) return; try { const stats = JSON.parse(raw) as Traffic; if (Number.isFinite(stats.totalDownloaded) && stats.totalDownloaded >= 0) relay.stats = stats; } catch { /* Estatística inválida não altera o último snapshot. */ } });
      await page.addInitScript(`window.NativeSegments = { ready: function(){window.relayReady=true;}, complete: function(id,chunk,done){window.relayComplete(id,chunk,done);}, fallback: function(id){window.relayFallback(id);}, stats:function(raw){window.relayStats(raw);} };`);
      await page.goto(base + '/player/android-bridge.html', { timeout: 10000 });
      await page.waitForFunction(() => (window as unknown as { relayReady?: boolean }).relayReady === true, undefined, { timeout: 10000 });
      const descriptor = await this.service.descriptor(seedGrant ?? id);
      if (this.closed || starting.cancelled) { await context.close(); return undefined; }
      await page.evaluate(({ value, seed }) => { const target = window as unknown as { HighpassBridge: { init(data: unknown, enabled: boolean, seed: boolean): void } }; target.HighpassBridge.init(value, true, seed); }, { value: descriptor, seed: Boolean(seedGrant) });
      if (this.closed || starting.cancelled) { await context.close(); return undefined; }
      this.sessions.set(id, relay); return relay;
    } catch { await context?.close().catch(() => undefined); logger.warn('Gateway indisponível; reprodução continuará por HTTP'); return undefined; }
  }
  async observe(id: string, token: string, base: string, uri: string, text: string) {
    const relay = await this.ensure(id, token, base);
    if (!relay) return;
    relay.lastUsed = Date.now();
    await relay.page.evaluate(({ url, manifest }) => { const target = window as unknown as { HighpassBridge: { playlist(uri: string, text: string): void } }; target.HighpassBridge.playlist(url, manifest); }, { url: base + uri, manifest: text });
  }
  async load(id: string, uri: string, base: string): Promise<Buffer | null> {
    const relay = this.sessions.get(id); if (!relay || relay.pending.size >= 4) return null; relay.lastUsed = Date.now();
    const request = randomUUID();
    return new Promise<Buffer | null>((resolve) => {
      const timer = setTimeout(() => finish(null), 14000);
      const finish = (buffer: Buffer | null) => { clearTimeout(timer); relay.pending.delete(request); resolve(buffer); };
      relay.pending.set(request, { chunks: [], size: 0, finish });
      void relay.page.evaluate(({ key, url }) => { const target = window as unknown as { HighpassBridge: { load(id: string, uri: string, position: number, length: number): void } }; target.HighpassBridge.load(key, url, 0, -1); }, { key: request, url: base + uri }).catch(() => finish(null));
    });
  }
  async httpOnly(id: string) { const relay = this.sessions.get(id); if (relay) await relay.page.evaluate(() => { const target = window as unknown as { HighpassBridge: { httpOnly(): void } }; target.HighpassBridge.httpOnly(); }).catch(() => undefined); }
  async resume(id: string) { const relay = this.sessions.get(id); if (relay) await relay.page.evaluate(() => { const target = window as unknown as { HighpassBridge: { resume(): void } }; target.HighpassBridge.resume(); }).catch(() => undefined); }
  async startSeed(key: string, grant: string, token: string, base: string) {
    return Boolean(await this.ensure(key, token, base, grant));
  }
  async seedStatus(key: string, positions: number[]) {
    const relay = this.sessions.get(key); if (!relay) return undefined; relay.lastUsed = Date.now();
    return relay.page.evaluate((targets) => {
      const bridge = (window as unknown as { HighpassBridge: { seedTargets(positions: number[]): void; seedStatus(): { ready: boolean; lastSegmentAt: number; loads: number; failures: number; positions: number[] } | undefined } }).HighpassBridge;
      bridge.seedTargets(targets); return bridge.seedStatus();
    }, positions).catch(() => undefined);
  }
  stopSeed(key: string) { return this.remove(key); }
  stopGateway(id: string) { return this.remove(id); }
  stats(id: string) { const relay = this.sessions.get(id); if (relay) { relay.lastUsed = Date.now(); return { ...relay.stats, transport: 'webrtc-gateway', scope: 'gateway-to-swarm' }; } return undefined; }
  http(id: string, bytes: number) { const relay = this.sessions.get(id); if (relay) void relay.page.evaluate((count) => { const target = window as unknown as { HighpassBridge: { http(bytes: number): void } }; target.HighpassBridge.http(count); }, bytes).catch(() => undefined); }
}
