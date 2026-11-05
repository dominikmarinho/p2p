import { telemetryId } from './telemetry.js';
export type StartupMark = 'startupAligned' | 'authorization' | 'playerCreated' | 'manifest' | 'seedReady' | 'peerConnected' | 'firstByte' | 'firstSegment' | 'firstFrame';
export interface StartupSample { attempt: string; clickedAt: string; kind: 'live' | 'movie' | 'episode'; content: string; elapsedMs: number; marks: Partial<Record<StartupMark, number>>; error?: string; frameMethod?: 'video-frame-callback' | 'playing-fallback' }
let armed = false; let current: (StartupSample & { beginning: number }) | undefined;
export function armStartupProbe(active: boolean) { armed = active; current = undefined; }
export function beginStartupProbe(kind: StartupSample['kind'], content: string) {
  if (!armed) return undefined;
  current = { attempt: telemetryId(), clickedAt: new Date().toISOString(), kind, content, elapsedMs: 0, marks: {}, beginning: performance.now() };
  return current.attempt;
}
export function markStartup(attempt: string | undefined, mark: StartupMark, frameMethod?: StartupSample['frameMethod'], at = performance.now()) {
  if (!armed || !attempt || current?.attempt !== attempt || current.marks[mark] !== undefined) return;
  current.marks[mark] = Math.max(0, at - current.beginning); if (frameMethod) current.frameMethod = frameMethod;
}
export function failStartup(attempt: string | undefined, code: string) {
  if (armed && attempt && current?.attempt === attempt && /^[a-zA-Z0-9_-]{1,64}$/.test(code)) current.error = code;
}
export function startupSnapshot(): StartupSample | undefined {
  if (!current || !armed) return undefined;
  const { beginning, ...value } = current;
  return { ...value, marks: { ...value.marks }, elapsedMs: Math.max(0, performance.now() - beginning) };
}
