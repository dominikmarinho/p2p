import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackPresence } from '../../src/modules/iptv/playback-presence.js';
afterEach(() => { vi.useRealTimers(); });
describe('presença do player e variantes no tracker', () => {
  it('libera apenas quando o último socket do grant fecha', async () => {
    vi.useFakeTimers(); const release = vi.fn(() => Promise.resolve()); const presence = new PlaybackPresence(release);
    presence.join('viewer', 'video'); presence.join('viewer', 'audio'); presence.leave('viewer', 'video');
    await vi.advanceTimersByTimeAsync(1500); expect(release).not.toHaveBeenCalled();
    presence.leave('viewer', 'audio'); await vi.advanceTimersByTimeAsync(999); expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(release).toHaveBeenCalledExactlyOnceWith('viewer'); presence.close();
  });
  it('reconectar cancela a liberação e uma saída duplicada não afeta outro player', async () => {
    vi.useFakeTimers(); const release = vi.fn(() => Promise.resolve()); const presence = new PlaybackPresence(release);
    presence.join('viewer', 'old'); presence.leave('viewer', 'old'); await vi.advanceTimersByTimeAsync(500);
    presence.join('viewer', 'new'); presence.leave('viewer', 'old'); await vi.advanceTimersByTimeAsync(1500);
    expect(release).not.toHaveBeenCalled(); presence.leave('viewer', 'new'); presence.close();
    await vi.advanceTimersByTimeAsync(2000); expect(release).not.toHaveBeenCalled();
  });
});
