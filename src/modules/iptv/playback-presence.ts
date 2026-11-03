/** Aggregate all tracker sockets of a playback before releasing its seed lease. */
export class PlaybackPresence {
  private readonly sockets = new Map<string, Set<string>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  constructor(private readonly release: (grant: string) => Promise<void>) {}
  join(grant: string, connection: string) {
    if (this.closed) return;
    const timer = this.timers.get(grant); if (timer) clearTimeout(timer); this.timers.delete(grant);
    const connections = this.sockets.get(grant) ?? new Set<string>(); connections.add(connection); this.sockets.set(grant, connections);
  }
  leave(grant: string, connection: string) {
    if (this.closed) return;
    const connections = this.sockets.get(grant); if (!connections?.delete(connection) || connections.size) return;
    this.sockets.delete(grant);
    const timer = setTimeout(() => { this.timers.delete(grant); if (!this.closed && !this.sockets.has(grant)) void this.release(grant).catch(() => undefined); }, 1000);
    timer.unref(); this.timers.set(grant, timer);
  }
  close() { this.closed = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.sockets.clear(); }
}
