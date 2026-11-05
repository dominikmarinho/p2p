/** A small rate correction preserves buffered video; it never seeks or jumps a frame. */
export function livePlaybackRate(latency: number, target: number, buffered: number, stalled: boolean): number {
  if (stalled || !Number.isFinite(latency) || !Number.isFinite(target) || target <= 0 || buffered < 12) return 1;
  if (latency > target + 3) return 1.02;
  if (latency < target - 3) return .98;
  return 1;
}

/** Only before the first frame: select real buffered media instead of waiting in an empty gap. */
export function liveStartupPosition(position: number, ranges: readonly (readonly [number, number])[], firstFrameShown: boolean, manualInteraction: boolean): number | undefined {
  if (firstFrameShown || manualInteraction || !Number.isFinite(position)) return undefined;
  if (ranges.some(([start, end]) => start <= position && end > position)) return undefined;
  const next = ranges.find(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && start > position + .5 && end - start >= 3);
  return next ? next[0] + .05 : undefined;
}
