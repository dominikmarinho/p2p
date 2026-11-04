import { afterEach, expect, it, vi } from 'vitest';
import { armStartupProbe, beginStartupProbe, markStartup, failStartup, startupSnapshot } from '../../apps/webplayer/src/p2p/startup-probe.js';
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
