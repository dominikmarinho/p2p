import type { SegmentStorage } from 'p2p-media-loader-core';

interface StoredSegment { stream: string; id: number; data: ArrayBuffer; storedAt: number }

/** A seed serves multiple playheads; its cache is bounded by bytes rather than one viewer's position. */
export class SeedSegmentStorage implements SegmentStorage {
  private readonly entries = new Map<string, StoredSegment>();
  private used = 0;
  private changed: ((stream: string) => void) | undefined;
  constructor(private readonly capacity = 64 * 1024 * 1024, private readonly maxEntries = 512) {}
  initialize() { return Promise.resolve(); }
  onPlaybackUpdated() { return; }
  onSegmentRequested() { return; }
  storeSegment(_swarm: string, stream: string, id: number, data: ArrayBuffer) {
    const key = `${stream}:${id}`; const old = this.entries.get(key);
    if (old) { this.used -= old.data.byteLength; this.entries.delete(key); }
    const affected = new Set<string>();
    if (data.byteLength > 0 && data.byteLength <= this.capacity) {
      while (this.used + data.byteLength > this.capacity || this.entries.size >= this.maxEntries) {
        const first = this.entries.entries().next().value; if (!first) break;
        this.entries.delete(first[0]); this.used -= first[1].data.byteLength; affected.add(first[1].stream);
      }
      this.entries.set(key, { stream, id, data, storedAt: Date.now() }); this.used += data.byteLength;
    }
    affected.add(stream); for (const value of affected) this.changed?.(value);
    return Promise.resolve();
  }
  getSegmentData(_swarm: string, stream: string, id: number) {
    const key = `${stream}:${id}`; const value = this.entries.get(key);
    if (value) { this.entries.delete(key); this.entries.set(key, value); }
    return Promise.resolve(value?.data);
  }
  hasSegment(_swarm: string, stream: string, id: number) { return this.entries.has(`${stream}:${id}`); }
  segmentStoredAt(_swarm: string, stream: string, id: number) { return this.entries.get(`${stream}:${id}`)?.storedAt; }
  getStoredSegmentIds(_swarm: string, stream: string) { return [...this.entries.values()].filter((entry) => entry.stream === stream).map((entry) => entry.id); }
  getUsage() { return { totalCapacity: this.capacity, usedCapacity: this.used }; }
  setSegmentChangeCallback(callback: ((stream: string) => void) | undefined) { this.changed = callback; }
  destroy() { this.entries.clear(); this.used = 0; this.changed = undefined; }
}
