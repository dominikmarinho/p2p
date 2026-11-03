import { describe, expect, it } from 'vitest';
import { trafficPercentages } from '../../apps/webplayer/src/p2p/stats.js';
describe('distribuição de bytes HTTP/P2P', () => {
  it('não inventa tráfego antes do primeiro byte', () => expect(trafficPercentages(0, 0)).toEqual({ totalDownloaded: 0, httpPercentage: 0, p2pPercentage: 0 }));
  it('calcula a proporção pelos bytes e mantém soma 100', () => {
    const result = trafficPercentages(200, 100); expect(result.totalDownloaded).toBe(300); expect(result.p2pPercentage).toBeCloseTo(100 / 3); expect(result.p2pPercentage + result.httpPercentage).toBe(100);
    expect(trafficPercentages(999, 0).httpPercentage).toBe(100); expect(trafficPercentages(0, 999).p2pPercentage).toBe(100);
  });
});
