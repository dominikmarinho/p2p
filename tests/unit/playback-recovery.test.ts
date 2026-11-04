import { expect, it } from 'vitest';
import { PlaybackRecovery } from '../../apps/webplayer/src/p2p/playback-recovery.js';
it('recupera um playhead preso e respeita pausa, seek e término do VOD', () => {
  let now = 0; const recovery = new PlaybackRecovery(() => now);
  expect(recovery.observe(10, true, false)).toBe(false); now = 35001;
  expect(recovery.observe(10, true, false)).toBe(true);
  expect(recovery.observe(10, false, false)).toBe(false); now += 36000;
  expect(recovery.observe(10, false, false)).toBe(false);
  expect(recovery.observe(10, true, true)).toBe(false); now += 36000;
  expect(recovery.observe(10, true, false, true)).toBe(false);
  recovery.restarted(); expect(recovery.observe(10, true, false)).toBe(false);
});
it('limita novas tentativas e restaura o intervalo após progresso real', () => {
  let now = 0; const recovery = new PlaybackRecovery(() => now);
  expect(Array.from({ length: 8 }, () => recovery.retryDelay())).toEqual([3000, 6000, 12000, 24000, 30000, 30000, 30000, 30000]);
  now = 50; recovery.observe(2, true, false); expect(recovery.retryDelay()).toBe(3000);
});
