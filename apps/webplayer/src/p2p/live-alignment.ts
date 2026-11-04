/** A small rate correction preserves buffered video; it never seeks or jumps a frame. */
export function livePlaybackRate(latency: number, target: number, buffered: number, stalled: boolean): number {
  if (stalled || !Number.isFinite(latency) || !Number.isFinite(target) || target <= 0 || buffered < 12) return 1;
  if (latency > target + 3) return 1.02;
  if (latency < target - 3) return .98;
  return 1;
}
