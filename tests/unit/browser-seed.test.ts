import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSeed } from '../../apps/webplayer/src/p2p/browser-seed.js';
import type { NativeSegmentCore } from '../../apps/webplayer/src/p2p/native-core.js';
import type { Playback } from '../../apps/webplayer/src/api.js';
import type { Segment } from 'p2p-media-loader-core';

const playback: Playback = { url: '/live/entry', trackerPath: '/tracker', swarmId: 's', expiresAt: 9999999999999, isLive: true, isHls: true, iceServers: [] };
let seed: BrowserSeed | undefined;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T00:00:00Z')); vi.stubGlobal('window', { location: { origin: 'https://p2p.remoto.api.br' } }); });
afterEach(() => { seed?.close(); seed = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(ended = false) {
  let sequence = 41; let ticket = 0; let segments: Segment[] = []; const cached = new Set<number>(); const storedAt = new Map<number, number>();
  const observePlaylist = vi.fn((_uri: string, text: string) => {
    const start = Number(text.match(/MEDIA-SEQUENCE:(\d+)/)?.[1]);
    segments = text.split('\n').filter((line) => line.startsWith('https://')).map((url, index) => ({ runtimeId: url, url, externalId: start + index, startTime: index * 11, endTime: (index + 1) * 11 }));
  });
  const load = vi.fn((uri: string) => { const segment = segments.find((entry) => entry.url === uri); if (segment) { cached.add(segment.externalId); storedAt.set(segment.externalId, Date.now()); } return Promise.resolve(new ArrayBuffer(4)); });
  const core = { observePlaylist, seedSegments: () => segments, hasCachedSeedSegment: (_uri: string, segment: Segment) => cached.has(segment.externalId), cachedSeedSegmentStoredAt: (_uri: string, segment: Segment) => storedAt.get(segment.externalId), load } as unknown as NativeSegmentCore;
  const manifest = () => '#EXTM3U\n#EXT-X-TARGETDURATION:11\n#EXT-X-MEDIA-SEQUENCE:' + sequence + '\n' + Array.from({ length: 6 }, (_, index) => `#EXTINF:11,\nhttps://p2p.remoto.api.br/segment/${sequence + index}?ticket=${ticket}\n`).join('') + (ended ? '#EXT-X-ENDLIST\n' : '');
  const fetcher = vi.fn(() => Promise.resolve(new Response(manifest(), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }))); vi.stubGlobal('fetch', fetcher);
  return { core, load, fetcher, advanceSequence: () => { sequence++; }, rotateTicket: () => { ticket++; }, prefetchNext: () => { sequence++; const id = sequence + 5; cached.add(id); storedAt.set(id, Date.now()); } };
}
describe('seed sem repetição de downloads nem sessões por segundo', () => {
  it('reutiliza segmentos e respeita metade do TARGETDURATION em recargas', async () => {
    const source = fixture(); seed = new BrowserSeed(source.core, playback);
    await vi.advanceTimersByTimeAsync(1); expect(source.load).toHaveBeenCalledTimes(6); expect(source.fetcher).toHaveBeenCalledTimes(1); expect(seed.status().ready).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); expect(source.load).toHaveBeenCalledTimes(6); expect(source.fetcher).toHaveBeenCalledTimes(1);
    source.advanceSequence(); await vi.advanceTimersByTimeAsync(1100);
    expect(source.fetcher).toHaveBeenCalledTimes(2); expect(source.load).toHaveBeenCalledTimes(7); expect(seed.status().loads).toBe(7);
    seed.targets([]); await vi.advanceTimersByTimeAsync(15000); expect(source.fetcher).toHaveBeenCalledTimes(2); expect(seed.status().ready).toBe(false);
  });
  it('não baixa a mesma sequência de novo quando somente o token da URL muda', async () => {
    const source = fixture(); seed = new BrowserSeed(source.core, playback); await vi.advanceTimersByTimeAsync(1);
    source.rotateTicket(); await vi.advanceTimersByTimeAsync(6100);
    expect(source.fetcher).toHaveBeenCalledTimes(2); expect(source.load).toHaveBeenCalledTimes(6); expect(seed.status().loads).toBe(6);
  });
  it('mantém VOD pronto pelo cache e atende um novo playhead sem refazer a playlist final', async () => {
    const source = fixture(true); seed = new BrowserSeed(source.core, { ...playback, isLive: false }); await vi.advanceTimersByTimeAsync(1);
    expect(source.load).toHaveBeenCalledTimes(3); await vi.advanceTimersByTimeAsync(60000);
    expect(source.load).toHaveBeenCalledTimes(3); expect(source.fetcher).toHaveBeenCalledTimes(1); expect(seed.status().ready).toBe(true);
    seed.targets([50]); await vi.advanceTimersByTimeAsync(1000);
    expect(source.load).toHaveBeenCalledTimes(5); expect(seed.status().positions).toEqual([50]); expect(source.fetcher).toHaveBeenCalledTimes(1);
  });
  it('reconhece a chegada real de um novo segmento prefetched sem baixar ou renovar o cache antigo', async () => {
    const source = fixture(); seed = new BrowserSeed(source.core, playback); await vi.advanceTimersByTimeAsync(1);
    const initialArrival = seed.status().lastSegmentAt;
    await vi.advanceTimersByTimeAsync(30000); expect(seed.status().lastSegmentAt).toBe(initialArrival);
    source.prefetchNext(); const prefetchedAt = Date.now(); await vi.advanceTimersByTimeAsync(6000);
    expect(seed.status().lastSegmentAt).toBe(prefetchedAt); expect(seed.status().ready).toBe(true); expect(source.load).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(34000); expect(seed.status().ready).toBe(false); expect(seed.status().lastSegmentAt).toBe(prefetchedAt);
  });
  it('retira prontidão quando o canal não produz novos segmentos, sem rebaixar contadores de falha', async () => {
    const source = fixture(); seed = new BrowserSeed(source.core, playback); await vi.advanceTimersByTimeAsync(1);
    expect(seed.status().ready).toBe(true); await vi.advanceTimersByTimeAsync(34000);
    expect(seed.status().ready).toBe(false); expect(seed.status().loads).toBe(6); expect(seed.status().failures).toBe(0);
    expect(source.fetcher.mock.calls.length).toBeLessThanOrEqual(7);
  });
});
