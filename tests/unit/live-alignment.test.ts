import { describe, expect, it } from 'vitest';
import { livePlaybackRate, liveStartupPosition } from '../../apps/webplayer/src/p2p/live-alignment.js';
describe('alinhamento suave do ao vivo', () => {
  it('mantém a velocidade normal dentro da margem', () => { expect(livePlaybackRate(44, 44, 20, false)).toBe(1); expect(livePlaybackRate(46, 44, 20, false)).toBe(1); });
  it('aproxima sem saltos com correção máxima de dois por cento', () => { expect(livePlaybackRate(60, 44, 20, false)).toBe(1.02); expect(livePlaybackRate(30, 44, 20, false)).toBe(.98); });
  it('preserva o buffer em rede lenta e durante interrupções', () => { expect(livePlaybackRate(60, 44, 5, false)).toBe(1); expect(livePlaybackRate(60, 44, 20, true)).toBe(1); expect(livePlaybackRate(Infinity, 44, 20, false)).toBe(1); });
});

describe('abertura ao vivo em buffer real', () => {
  it('corrige o caso observado: playhead 20s e buffer começando em 28,30s', () => {
    expect(liveStartupPosition(20.002, [[28.300223, 40.010647]], false, false)).toBeCloseTo(28.350223);
  });
  it('alinha antes do primeiro frame mesmo quando a busca interna inicial aguarda dados', () => {
    const media = { currentTime: 20.042, seeking: true, manuallySeeking: false, buffered: [[28.3682, 70.005314]] as const };
    expect(liveStartupPosition(media.currentTime, media.buffered, false, media.manuallySeeking)).toBeCloseTo(28.4182);
  });
  it('não salta quando já existe vídeo na posição ou a reprodução começou', () => {
    expect(liveStartupPosition(30, [[28, 40]], false, false)).toBeUndefined();
    expect(liveStartupPosition(20, [[28, 40]], true, false)).toBeUndefined();
    expect(liveStartupPosition(20, [[28, 40]], false, true)).toBeUndefined();
  });
  it('exige buffer suficiente e ignora lacunas mínimas e valores inválidos', () => {
    expect(liveStartupPosition(20, [[28, 29]], false, false)).toBeUndefined();
    expect(liveStartupPosition(20, [[20.1, 30]], false, false)).toBeUndefined();
    expect(liveStartupPosition(20, [], false, false)).toBeUndefined();
    expect(liveStartupPosition(NaN, [[28, 40]], false, false)).toBeUndefined();
  });
});
