import { absoluteUrl, type Playback } from '../api.js';
import type { P2PStats } from './stats.js';

export function telemetryId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // WebView permits getRandomValues on emulator loopback HTTP builds too.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64; bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class PlaybackReporter {
  private readonly clientId = telemetryId();
  private readonly timer: ReturnType<typeof setInterval>;
  private previous = { httpDownloaded: 0, p2pDownloaded: 0 };
  private error: string | undefined;
  private busy = false;
  private readonly onError = (event: Event) => { const detail = (event as CustomEvent<{ code: string }>).detail; if (/^[a-zA-Z0-9_]{1,64}$/.test(detail.code)) this.error = detail.code; };
  constructor(private readonly playback: Playback, private readonly client: 'web' | 'bridge', private readonly snapshot: () => P2PStats) {
    window.addEventListener('highpass:playback-error', this.onError);
    this.timer = setInterval(() => { void this.send(); }, 5000);
  }
  private async send(final = false) {
    if (!this.playback.telemetryPath || this.busy) return; this.busy = true;
    const stats = this.snapshot(); const error = this.error;
    const mode = stats.p2pDownloaded > this.previous.p2pDownloaded ? 'p2p' : stats.httpDownloaded > this.previous.httpDownloaded ? 'http' : 'waiting';
    try {
      const response = await fetch(absoluteUrl(this.playback.telemetryPath), { method: 'POST', credentials: 'same-origin', keepalive: final, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: this.clientId, client: this.client, mode, http: Math.round(stats.httpDownloaded), p2p: Math.round(stats.p2pDownloaded), upload: Math.round(stats.p2pUploaded), ...(error ? { error } : {}) }), signal: AbortSignal.timeout(4000) });
      if (response.ok) { this.previous = stats; if (this.error === error) this.error = undefined; }
    } catch { /* A telemetria não interfere na reprodução. */ }
    finally { this.busy = false; }
  }
  destroy() { clearInterval(this.timer); window.removeEventListener('highpass:playback-error', this.onError); void this.send(true); }
}
