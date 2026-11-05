import { afterEach, expect, it, vi } from 'vitest';
import { waitForUsefulIce } from '../../apps/webplayer/src/p2p/ice-gathering.js';
function connection(urls: string[] = ['stun:slow.test', 'turn:relay.test']) {
  const events = new EventTarget(); const state = { iceGatheringState: 'gathering', signalingState: 'stable', localDescription: { sdp: '' }, getConfiguration: () => ({ iceServers: urls.map((url) => ({ urls: url })) }), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  return { state, pc: state as unknown as RTCPeerConnection, candidate: (type: string) => { state.localDescription.sdp += `a=candidate:1 1 udp 1 1.2.3.4 123 typ ${type}\r\n`; events.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: { type } })); }, events };
}
afterEach(() => vi.useRealTimers());
it('envia SDP 200ms após obter relay, sem aguardar STUN lento por oito segundos', async () => {
  vi.useFakeTimers(); const c = connection(); let completed = false;
  const promise = waitForUsefulIce(c.pc, 8000, new AbortController().signal).then(() => { completed = true; });
  c.candidate('host'); c.candidate('srflx'); await vi.advanceTimersByTimeAsync(1000); expect(completed).toBe(false);
  c.candidate('relay'); await vi.advanceTimersByTimeAsync(199); expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await promise; expect(completed).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('preserva o prazo total quando TURN ainda não respondeu em rede restritiva', async () => {
  vi.useFakeTimers(); const c = connection(); let completed = false;
  const promise = waitForUsefulIce(c.pc, 8000, new AbortController().signal).then(() => { completed = true; });
  c.candidate('host'); c.candidate('srflx'); await vi.advanceTimersByTimeAsync(7999); expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await promise; expect(completed).toBe(true);
});
it('sem TURN, aceita candidato público ou rede local sem servidores ICE', async () => {
  vi.useFakeTimers(); for (const [urls, type] of [[['stun:public.test'], 'srflx'], [[], 'host']] as const) {
    const c = connection([...urls]); const promise = waitForUsefulIce(c.pc, 8000, new AbortController().signal);
    c.candidate(type); await vi.advanceTimersByTimeAsync(200); await promise; expect(vi.getTimerCount()).toBe(0);
  }
});
it('encerra timers na conclusão, fechamento ou cancelamento', async () => {
  vi.useFakeTimers(); const c = connection(); const controller = new AbortController();
  const promise = waitForUsefulIce(c.pc, 8000, controller.signal); const rejection = expect(promise).rejects.toThrow('aborted');
  c.candidate('relay'); controller.abort(); await rejection; expect(vi.getTimerCount()).toBe(0);
  const closed = connection(); closed.state.signalingState = 'closed'; await expect(waitForUsefulIce(closed.pc, 8000, new AbortController().signal)).rejects.toThrow('closed');
  const complete = connection(); complete.state.iceGatheringState = 'complete'; await waitForUsefulIce(complete.pc, 8000, new AbortController().signal); expect(vi.getTimerCount()).toBe(0);
});
