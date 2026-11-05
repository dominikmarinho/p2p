export type PeerPath = 'direct' | 'relay' | 'unknown';
interface Stat { id: string; type: string; selectedCandidatePairId?: string; nominated?: boolean; state?: string; localCandidateId?: string; remoteCandidateId?: string; candidateType?: string }
/** Only the selected candidate pair is evidence of the path actually used. */
export function selectedPeerPath(report: RTCStatsReport): PeerPath {
  let pair: Stat | undefined;
  report.forEach((raw: unknown) => { const row = raw as Stat; if (row.type === 'transport' && row.selectedCandidatePairId) pair = report.get(row.selectedCandidatePairId) as Stat | undefined; });
  if (!pair) report.forEach((raw: unknown) => { const row = raw as Stat; if (row.type === 'candidate-pair' && row.nominated && row.state === 'succeeded') pair = row; });
  if (!pair?.localCandidateId || !pair.remoteCandidateId) return 'unknown';
  const local = report.get(pair.localCandidateId) as Stat | undefined; const remote = report.get(pair.remoteCandidateId) as Stat | undefined;
  if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') return 'relay';
  return local?.candidateType && remote?.candidateType ? 'direct' : 'unknown';
}
const observed = new WeakSet<RTCPeerConnection>();
/** Emits counts/classification only; no addresses, SDP, TURN credentials or peer identifiers leave this module. */
export function observePeerPath(pc: RTCPeerConnection): RTCPeerConnection {
  if (observed.has(pc)) return pc; observed.add(pc);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''); let closed = false; let busy = false;
  const publish = (path: PeerPath | 'closed') => window.dispatchEvent(new CustomEvent('highpass:peer-path', { detail: { id, path } }));
  const sample = async () => {
    if (closed || busy) return;
    if (pc.connectionState === 'closed' || pc.signalingState === 'closed') { close(); return; }
    if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') { publish('unknown'); return; }
    busy = true;
    try { const path = selectedPeerPath(await pc.getStats()); if (!closed) publish(path); }
    catch { if (!closed) publish('unknown'); }
    finally { busy = false; }
  };
  const changed = () => { void sample(); };
  const timer = setInterval(changed, 5000);
  const close = () => { if (closed) return; closed = true; clearInterval(timer); pc.removeEventListener('connectionstatechange', changed); pc.removeEventListener('iceconnectionstatechange', changed); publish('closed'); };
  pc.addEventListener('connectionstatechange', changed); pc.addEventListener('iceconnectionstatechange', changed); changed();
  return pc;
}
export class PeerPathCounter {
  private readonly paths = new Map<string, PeerPath>();
  private readonly changed = (event: Event) => { const value = (event as CustomEvent<{ id: string; path: PeerPath | 'closed' }>).detail; if (!value?.id || !['direct', 'relay', 'unknown', 'closed'].includes(value.path)) return; if (value.path === 'closed') this.paths.delete(value.id); else if (this.paths.size < 100 || this.paths.has(value.id)) this.paths.set(value.id, value.path); };
  constructor() { window.addEventListener('highpass:peer-path', this.changed); }
  snapshot() { const result = { direct: 0, relay: 0, unknown: 0 }; for (const path of this.paths.values()) result[path]++; return result; }
  destroy() { window.removeEventListener('highpass:peer-path', this.changed); this.paths.clear(); }
}
