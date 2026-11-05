import { afterEach, expect, it, vi } from 'vitest';
import { armStartupProbe, beginStartupProbe, markStartup, failStartup, startupSnapshot, startupHistory, reportStartupTraffic, reportStartupSegment } from '../../apps/webplayer/src/p2p/startup-probe.js';
afterEach(() => { armStartupProbe(false); vi.restoreAllMocks(); });
it('mede do clique ao primeiro frame somente após consentimento e ignora eventos de outra seleção', () => {
  expect(beginStartupProbe('live', '1')).toBeUndefined(); expect(startupSnapshot()).toBeUndefined();
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
  armStartupProbe(true); const first = beginStartupProbe('live', '1'); clock.mockReturnValue(1100); markStartup(first, 'authorization');
  clock.mockReturnValue(1600); markStartup(first, 'firstFrame', 'video-frame-callback'); markStartup(first, 'authorization');
  expect(startupSnapshot()?.marks).toEqual({ authorization: 1000, firstFrame: 1500 });
  const next = beginStartupProbe('movie', '2'); markStartup(first, 'firstFrame'); expect(startupSnapshot()?.marks).toEqual({});
  failStartup(next, 'authorizationFailed'); expect(startupSnapshot()?.error).toBe('authorizationFailed');
  armStartupProbe(false); expect(startupSnapshot()).toBeUndefined();
});

it('mantém somente nove tentativas anteriores e limpa todo o histórico ao parar', () => {
  armStartupProbe(true);
  for (let i = 1; i <= 12; i++) { const id = beginStartupProbe('live', String(i)); markStartup(id, 'authorization'); }
  expect(startupHistory()).toHaveLength(9); expect(startupHistory()[0]?.content).toBe('3'); expect(startupSnapshot()?.content).toBe('12');
  const id = startupSnapshot()!.attempt;
  reportStartupSegment(id, { bytes: 1000, durationSeconds: 4, loadMs: 120, transferMs: 100, averageBps: 10000, source: 'p2p' });
  reportStartupTraffic(id, { httpBytes: 0, p2pBytes: 1000, uploadBytes: 200, peers: 2, downloadBps: 10000, uploadBps: 2000, paths: { direct: 1, relay: 1, unknown: 0 } });
  expect(startupSnapshot()?.firstSegment?.bytes).toBe(1000); expect(startupSnapshot()?.traffic?.uploadBytes).toBe(200);
  armStartupProbe(false); expect(startupHistory()).toEqual([]); expect(startupSnapshot()).toBeUndefined();
});
