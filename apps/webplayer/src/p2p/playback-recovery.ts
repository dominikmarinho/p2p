/** Detects a stuck playhead without treating a pause, seek or ended VOD as a fault. */
export class PlaybackRecovery {
  private lastProgress: number;
  private position = 0;
  private attempts = 0;
  constructor(private readonly now: () => number = () => performance.now()) { this.lastProgress = now(); }
  observe(position: number, wanted: boolean, ended: boolean, seeking = false): boolean {
    const advanced = Number.isFinite(position) && Math.abs(position - this.position) > .1;
    if (advanced || !wanted || ended || seeking) { this.lastProgress = this.now(); if (advanced) this.attempts = 0; }
    this.position = position;
    return wanted && !ended && !seeking && this.now() - this.lastProgress >= 35000;
  }
  restarted() { this.lastProgress = this.now(); }
  retryDelay() { return Math.min(30000, 3000 * 2 ** Math.min(this.attempts++, 4)); }
}
