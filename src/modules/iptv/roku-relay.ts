import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { IptvService } from './iptv.service.js';

interface Traffic { httpDownloaded: number; p2pDownloaded: number; p2pUploaded: number; peers: number; totalDownloaded: number; httpPercentage: number; p2pPercentage: number }
interface Pending { chunks: Buffer[]; size: number; finish: (buffer: Buffer | null) => void }
interface Relay { context: BrowserContext; page: Page; lastUsed: number; stats: Traffic; pending: Map<string, Pending> }
export class RokuRelay {
  private browser: Promise<Browser> | undefined;
  private readonly sessions = new Map<string, Relay>();
  private readonly starts = new Map<string, Promise<Relay | undefined>>();
  private readonly timer: NodeJS.Timeout;
  constructor(private readonly service: IptvService) {
    this.timer = setInterval(() => { for (const [id, relay] of this.sessions) if (Date.now() - relay.lastUsed > 90000) void this.remove(id); }, 30000); this.timer.unref();
  }
  async close() { clearInterval(this.timer); await Promise.allSettled([...this.sessions.keys()].map((id) => this.remove(id))); await (await this.browser?.catch(() => undefined))?.close(); }
  private async remove(id: string) { const relay = this.sessions.get(id); this.sessions.delete(id); if (relay) { for (const request of relay.pending.values()) request.finish(null); await relay.context.close().catch(() => undefined); } }
  private async start(id: string, token: string, base: string): Promise<Relay | undefined> {
    if (this.sessions.size + this.starts.size >= this.service.env.P2P_RELAY_MAX_SESSIONS) return undefined;
    this.browser ??= chromium.launch({ ...(this.service.env.CHROMIUM_PATH ? { executablePath: this.service.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
    let context: BrowserContext | undefined;
    try {
      const browser = await this.browser; context = await browser.newContext({ bypassCSP: true, extraHTTPHeaders: { 'x-highpass-relay': this.service.relaySecret } });
      await context.addCookies([{ name: 'HP_SESSION', value: token, domain: '127.0.0.1', path: '/api/iptv', httpOnly: true, secure: false, sameSite: 'Strict' }]);
      const page = await context.newPage(); const pending = new Map<string, Pending>();
      const relay: Relay = { context, page, lastUsed: Date.now(), pending, stats: { httpDownloaded: 0, p2pDownloaded: 0, p2pUploaded: 0, peers: 0, totalDownloaded: 0, httpPercentage: 0, p2pPercentage: 0 } };
      await page.exposeFunction('relayComplete', (request: string, chunk: string, done: boolean) => {
        const task = pending.get(request); if (!task) return; const data = Buffer.from(chunk, 'base64'); task.size += data.length;
        if (task.size > 16 * 1024 * 1024) { task.finish(null); return; } task.chunks.push(data); if (done) task.finish(Buffer.concat(task.chunks));
      });
      await page.exposeFunction('relayFallback', (request: string) => pending.get(request)?.finish(null));
      await page.exposeFunction('relayStats', (raw: string) => { if (raw.length > 4096) return; try { const stats = JSON.parse(raw) as Traffic; if (Number.isFinite(stats.totalDownloaded) && stats.totalDownloaded >= 0) relay.stats = stats; } catch { /* Estatística inválida não altera o último snapshot. */ } });
      await page.addInitScript(`window.NativeSegments = { ready: function(){window.relayReady=true;}, complete: function(id,chunk,done){window.relayComplete(id,chunk,done);}, fallback: function(id){window.relayFallback(id);}, stats:function(raw){window.relayStats(raw);} };`);
      await page.goto(base + '/player/android-bridge.html', { timeout: 10000 });
      await page.waitForFunction('window.relayReady === true', { timeout: 10000 });
      const descriptor = await this.service.descriptor(id);
      await page.evaluate((value) => { const target = window as unknown as { HighpassBridge: { init(data: unknown, enabled: boolean): void } }; target.HighpassBridge.init(value, true); }, descriptor);
      this.sessions.set(id, relay); return relay;
    } catch { await context?.close().catch(() => undefined); this.browser = undefined; return undefined; }
  }
  async observe(id: string, token: string, base: string, uri: string, text: string) {
    let relay = this.sessions.get(id);
    if (!relay) { let start = this.starts.get(id); if (!start) { start = this.start(id, token, base).finally(() => this.starts.delete(id)); this.starts.set(id, start); } relay = await start; }
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
  stats(id: string) { const relay = this.sessions.get(id); if (relay) { relay.lastUsed = Date.now(); return { ...relay.stats, transport: 'webrtc-gateway', scope: 'gateway-to-swarm' }; } return undefined; }
  http(id: string, bytes: number) { const relay = this.sessions.get(id); if (relay) void relay.page.evaluate((count) => { const target = window as unknown as { HighpassBridge: { http(bytes: number): void } }; target.HighpassBridge.http(count); }, bytes).catch(() => undefined); }
}
