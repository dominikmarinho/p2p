import { absoluteUrl, type Playback } from '../api.js';

/** Deadline de entrega por segmento, com circuito HTTP temporário e nova tentativa P2P. */
export class DeliveryPolicy {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly expired = new Set<string>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
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
  }
  private async touch() {
    if (this.closed || !this.playback.delivery) return;
    if (this.touching || Date.now() - this.lastTouch < 800) {
      if (!this.queuedTouch) this.queuedTouch = setTimeout(() => { this.queuedTouch = undefined; void this.touch(); }, Math.max(50, 800 - (Date.now() - this.lastTouch)));
      return;
    }
    this.touching = true; this.lastTouch = Date.now();
    try {
      const response = await fetch(absoluteUrl(this.playback.delivery.seedPath), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: this.position }), signal: AbortSignal.timeout(5000) });
      if (response.ok && typeof response.json === 'function') {
        const value = await response.json() as { state?: string };
        // Warming is a live P2P attempt, not an offline seed. A real delivery
        // deadline, or an explicitly unavailable seed, is required for HTTP.
        if (!this.closed && value.state === 'unavailable') { this.seedUnavailable = true; if (!this.peerDelivered) this.fallback(); }
        else if (!this.closed && value.state === 'ready' && this.seedUnavailable) { this.seedUnavailable = false; this.retryP2P(); }
      }
    }
    catch { /* O prazo de cada segmento mantém o fallback disponível. */ }
    finally { this.touching = false; }
  }
  begin(id: string, position: number) {
    if (this.closed) return;
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
    if (this.closed) return;
    if (id) this.expired.add(id);
    this.httpUntil = Date.now() + (this.playback.delivery?.recoveryMs ?? 5000); this.change(true);
    if (this.recovery) clearTimeout(this.recovery);
    this.recovery = setTimeout(() => { this.httpUntil = 0; if (!this.closed) this.change(false); }, this.playback.delivery?.recoveryMs ?? 5000);
  }
  recovered(id?: string) { this.peerDelivered = true; this.seedUnavailable = false; if (this.closed || (this.expired.size > 0 && !(this.expired.size === 1 && id && this.expired.has(id)))) return; this.httpUntil = 0; if (this.recovery) clearTimeout(this.recovery); this.change(false); }
  retryP2P() { if (this.closed) return; this.httpUntil = 0; if (this.recovery) clearTimeout(this.recovery); this.change(false); }
  destroy() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.heartbeat); if (this.queuedTouch) clearTimeout(this.queuedTouch); if (this.recovery) clearTimeout(this.recovery);
    for (const timer of this.pending.values()) clearTimeout(timer); this.pending.clear(); this.expired.clear();
    if (this.playback.delivery) void fetch(absoluteUrl(this.playback.delivery.seedPath), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  }
}
