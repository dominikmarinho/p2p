import { describe, expect, it, vi } from 'vitest';
import { SeedSegmentStorage } from '../../apps/webplayer/src/p2p/seed-storage.js';

describe('cache compartilhado e limitado do seed', () => {
  it('reutiliza uma sequência mesmo quando a URL autenticada muda e limita RAM', async () => {
    const storage = new SeedSegmentStorage(8, 3); const changed = vi.fn(); storage.setSegmentChangeCallback(changed);
    await storage.storeSegment('swarm', 'video', 41, new Uint8Array([1, 2, 3, 4]).buffer);
    expect(storage.hasSegment('swarm', 'video', 41)).toBe(true);
    expect(await storage.getSegmentData('swarm', 'video', 41)).toEqual(new Uint8Array([1, 2, 3, 4]).buffer);
    await storage.storeSegment('swarm', 'video', 42, new Uint8Array([5, 6, 7, 8]).buffer);
    await storage.getSegmentData('swarm', 'video', 41);
    await storage.storeSegment('swarm', 'audio', 41, new Uint8Array([9, 10, 11, 12]).buffer);
    expect(storage.hasSegment('swarm', 'video', 42)).toBe(false);
    expect(storage.hasSegment('swarm', 'video', 41)).toBe(true);
    expect(storage.hasSegment('swarm', 'audio', 41)).toBe(true);
    expect(storage.getUsage().usedCapacity).toBe(8); expect(changed).toHaveBeenCalledWith('video'); expect(changed).toHaveBeenCalledWith('audio');
    await storage.storeSegment('swarm', 'video', 41, new Uint8Array([1]).buffer);
    expect(storage.getUsage().usedCapacity).toBe(5);
    storage.destroy(); expect(storage.getUsage().usedCapacity).toBe(0);
  });
  it('mantém a hora de chegada ao ler um segmento em cache', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const storage = new SeedSegmentStorage(8); await storage.storeSegment('s', 'video', 1, new ArrayBuffer(4));
      clock.mockReturnValue(34000); await storage.getSegmentData('s', 'video', 1);
      expect(storage.segmentStoredAt('s', 'video', 1)).toBe(1000);
      await storage.storeSegment('s', 'video', 2, new ArrayBuffer(4)); expect(storage.segmentStoredAt('s', 'video', 2)).toBe(34000);
    } finally { clock.mockRestore(); }
  });
  it('não anuncia segmento vazio ou maior que o limite e limita a quantidade de entradas', async () => {
    const storage = new SeedSegmentStorage(8, 2);
    await storage.storeSegment('s', 'video', 1, new ArrayBuffer(9)); expect(storage.getStoredSegmentIds('s', 'video')).toEqual([]);
    await storage.storeSegment('s', 'video', 0, new ArrayBuffer(0)); expect(storage.getStoredSegmentIds('s', 'video')).toEqual([]);
    for (const id of [1, 2, 3]) await storage.storeSegment('s', 'video', id, new ArrayBuffer(1));
    expect(storage.getStoredSegmentIds('s', 'video')).toEqual([2, 3]);
  });
});
