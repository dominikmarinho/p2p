import { describe, expect, it } from 'vitest';
import { livePlaybackRate } from '../../apps/webplayer/src/p2p/live-alignment.js';
describe('alinhamento suave do ao vivo', () => {
  it('mantém a velocidade normal dentro da margem', () => { expect(livePlaybackRate(44, 44, 20, false)).toBe(1); expect(livePlaybackRate(46, 44, 20, false)).toBe(1); });
  it('aproxima sem saltos com correção máxima de dois por cento', () => { expect(livePlaybackRate(60, 44, 20, false)).toBe(1.02); expect(livePlaybackRate(30, 44, 20, false)).toBe(.98); });
  it('preserva o buffer em rede lenta e durante interrupções', () => { expect(livePlaybackRate(60, 44, 5, false)).toBe(1); expect(livePlaybackRate(60, 44, 20, true)).toBe(1); expect(livePlaybackRate(Infinity, 44, 20, false)).toBe(1); });
});
