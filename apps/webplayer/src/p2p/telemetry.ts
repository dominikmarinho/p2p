import { absoluteUrl, type Playback } from '../api.js';
import type { P2PStats } from './stats.js';

export class PlaybackReporter {
  private readonly clientId = crypto.randomUUID();
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
