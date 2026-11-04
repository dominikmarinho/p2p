import { markStartup } from './startup-probe.js';
import { absoluteUrl, type Playback } from '../api.js';

/** Deadline de entrega por segmento, com circuito HTTP temporário e nova tentativa P2P. */
export class DeliveryPolicy {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly expired = new Set<string>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private suspended = false;
  private touchController: AbortController | undefined;
  private leaseReleased = false;
  private readonly onPageHide = () => this.suspend();
  private readonly onPageShow = () => this.resume();
  private recovery: ReturnType<typeof setTimeout> | undefined;
  private position = 0;
  private closed = false;
  private touching = false;
  private queuedTouch: ReturnType<typeof setTimeout> | undefined;
  private lastTouch = 0;
  private httpUntil = 0;
  private allowed = false;
  private seedUnavailable = false;
  private peerDelivered = false;
  private change(allowed: boolean) { if (this.allowed !== allowed) { this.allowed = allowed; this.allowHttp(allowed); } }
  constructor(private readonly playback: Playback, private readonly allowHttp: (allowed: boolean) => void) {
    this.allowHttp(false);
    void this.touch();
    this.heartbeat = setInterval(() => { void this.touch(); }, 5000);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
  }
  private async touch() {
    if (this.closed || this.suspended || !this.playback.delivery) return;
    if (this.touching || Date.now() - this.lastTouch < 800) {
      if (!this.queuedTouch) this.queuedTouch = setTimeout(() => { this.queuedTouch = undefined; void this.touch(); }, Math.max(50, 800 - (Date.now() - this.lastTouch)));
      return;
    }
    this.touching = true; this.lastTouch = Date.now();
    const controller = new AbortController(); this.touchController = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(absoluteUrl(this.playback.delivery.seedPath), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: this.position }), signal: controller.signal });
      if (this.touchController === controller && !this.suspended && !this.closed && response.ok && typeof response.json === 'function') {
        const value = await response.json() as { state?: string }; if (value.state === 'ready') markStartup(this.playback.startupAttempt, 'seedReady');
        // Warming is a live P2P attempt, not an offline seed. A real delivery
        // deadline, or an explicitly unavailable seed, is required for HTTP.
        if (this.touchController === controller && !this.closed && !this.suspended && value.state === 'unavailable') { this.seedUnavailable = true; if (!this.peerDelivered) this.fallback(); }
        else if (this.touchController === controller && !this.closed && !this.suspended && value.state === 'ready' && this.seedUnavailable) { this.seedUnavailable = false; this.retryP2P(); }
      }
    }
    catch { /* O prazo de cada segmento mantém o fallback disponível. */ }
    finally { clearTimeout(timeout); if (this.touchController === controller) { this.touchController = undefined; this.touching = false; } }
  }
  begin(id: string, position: number) {
    if (this.closed || this.suspended) return;
    this.position = Math.max(0, Number.isFinite(position) ? position : 0); void this.touch();
    this.finish(id);
    if (Date.now() < this.httpUntil) { this.change(true); return; }
    this.change(false);
    this.pending.set(id, setTimeout(() => { this.pending.delete(id); this.fallback(id); }, this.playback.delivery?.segmentTimeoutMs ?? 3000));
  }
  get httpAllowed() { return Date.now() < this.httpUntil; }
  playhead(position: number) { this.position = Math.max(0, Number.isFinite(position) ? position : 0); void this.touch(); }
  reset() { for (const timer of this.pending.values()) clearTimeout(timer); this.pending.clear(); this.expired.clear(); }
  finish(id: string) { const timer = this.pending.get(id); if (timer) clearTimeout(timer); this.pending.delete(id); this.expired.delete(id); }
  fallback(id?: string) {
    if (this.closed || this.suspended || this.playback.delivery?.mode === 'p2p-only') return;
    if (id) this.expired.add(id);
    this.httpUntil = Date.now() + (this.playback.delivery?.recoveryMs ?? 5000); this.change(true);
    if (this.recovery) clearTimeout(this.recovery);
    this.recovery = setTimeout(() => { this.httpUntil = 0; if (!this.closed) this.change(false); }, this.playback.delivery?.recoveryMs ?? 5000);
  }
  recovered(id?: string) { this.peerDelivered = true; this.seedUnavailable = false; if (this.closed || this.suspended || (this.expired.size > 0 && !(this.expired.size === 1 && id && this.expired.has(id)))) return; this.httpUntil = 0; if (this.recovery) clearTimeout(this.recovery); this.change(false); }
  retryP2P() { if (this.closed || this.suspended) return; this.httpUntil = 0; if (this.recovery) clearTimeout(this.recovery); this.change(false); }
  /** pagehide fires on navigation/closing, whereas hiding a playing tab must retain its lease. */
  suspend() {
    if (this.closed || this.suspended) return;
    this.suspended = true; this.stopTimers(); this.release();
  }
  resume() {
    if (this.closed || !this.suspended) return;
    this.suspended = false; this.leaseReleased = false; this.lastTouch = 0; this.change(false);
    this.heartbeat = setInterval(() => { void this.touch(); }, 5000); void this.touch();
  }
  private stopTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = undefined;
    if (this.queuedTouch) clearTimeout(this.queuedTouch); this.queuedTouch = undefined;
    if (this.recovery) clearTimeout(this.recovery); this.recovery = undefined;
    this.touchController?.abort(); this.touchController = undefined; this.touching = false;
    this.reset(); this.httpUntil = 0;
  }
  private release() {
    if (this.leaseReleased || !this.playback.delivery) return;
    this.leaseReleased = true;
    void fetch(absoluteUrl(this.playback.delivery.seedPath), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  }
  destroy() {
    if (this.closed) return;
    this.closed = true; this.stopTimers(); this.release();
    window.removeEventListener('pagehide', this.onPageHide); window.removeEventListener('pageshow', this.onPageShow);
  }
}
