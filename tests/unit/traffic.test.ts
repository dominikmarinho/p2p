import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialStats, trackStats, trafficPercentages } from '../../apps/webplayer/src/p2p/stats.js';
describe('distribuição de bytes HTTP/P2P', () => {
  it('não inventa tráfego antes do primeiro byte', () => expect(trafficPercentages(0, 0)).toEqual({ totalDownloaded: 0, httpPercentage: 0, p2pPercentage: 0 }));
  it('calcula a proporção pelos bytes e mantém soma 100', () => {
    const result = trafficPercentages(200, 100); expect(result.totalDownloaded).toBe(300); expect(result.p2pPercentage).toBeCloseTo(100 / 3); expect(result.p2pPercentage + result.httpPercentage).toBe(100);
    expect(trafficPercentages(999, 0).httpPercentage).toBe(100); expect(trafficPercentages(0, 999).p2pPercentage).toBe(100);
  });
});

describe('estado atual do transporte', () => {
  afterEach(() => vi.useRealTimers());
  it('informa P2P após recuperação mesmo com bytes HTTP acumulados', () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const engine = { addEventListener: (name: string, listener: (...args: unknown[]) => void) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name) };
    let latest = { ...initialStats }; const tracker = trackStats(engine, (value) => { latest = value; });
    listeners.get('onChunkDownloaded')?.(1000, 'http'); vi.advanceTimersByTime(1000); expect(latest.deliveryMode).toBe('http');
    listeners.get('onChunkDownloaded')?.(500, 'p2p'); vi.advanceTimersByTime(1000);
    expect(latest.deliveryMode).toBe('p2p'); expect(latest.httpDownloaded).toBe(1000); expect(latest.p2pPercentage).toBeCloseTo(100 / 3);
    listeners.get('onChunkDownloaded')?.(200, 'http'); vi.advanceTimersByTime(1000); expect(latest.deliveryMode).toBe('http'); tracker.destroy();
  });
});
