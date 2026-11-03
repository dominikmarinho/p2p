import type { Playback } from '../api.js';
import { absoluteUrl } from '../api.js';
import type { NativeSegmentCore } from './native-core.js';

interface ManifestSnapshot { text: string; refreshAt: number; targetMs: number; master: boolean }

export class BrowserSeed {
  private positions: number[] = [0];
  private closed = false;
  private cursor = 0;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | undefined;
  private readonly manifests = new Map<string, ManifestSnapshot>();
  private freshnessMs = 15000;
  private statusValue = { ready: false, lastSegmentAt: 0, loads: 0, failures: 0, positions: [] as number[], manifestRequests: 0 };
  constructor(private readonly core: NativeSegmentCore, private readonly playback: Playback) { void this.cycle(); }
  targets(positions: number[]) {
    this.positions = positions.filter(Number.isFinite).slice(0, 32); this.paused = !this.positions.length;
    if (this.paused) { this.request?.abort(); this.statusValue.ready = false; }
  }
  status() {
    return { ...this.statusValue, positions: [...this.statusValue.positions], ready: !this.paused && this.statusValue.ready && (!this.playback.isLive || Date.now() - this.statusValue.lastSegmentAt < this.freshnessMs) };
  }
  close() { this.closed = true; this.request?.abort(); if (this.timer) clearTimeout(this.timer); this.manifests.clear(); }
  private async manifest(uri: string) {
    const cached = this.manifests.get(uri);
    if (cached && Date.now() < cached.refreshAt) return cached;
    const controller = new AbortController(); this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      this.statusValue.manifestRequests++;
      const response = await fetch(uri, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error('Manifest indisponível');
      const reader = response.body?.getReader(); if (!reader) throw new Error('Manifest vazio');
      const parts: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1024 * 1024) throw new Error('Manifest excedeu limite'); parts.push(part.value); } }
      finally { await reader.cancel().catch(() => undefined); }
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      const text = new TextDecoder().decode(bytes);
      if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Manifest inválido');
      const master = /^#EXT-X-STREAM-INF:/m.test(text);
      const targetMs = Math.max(1000, Math.min(60000, Number(text.match(/^#EXT-X-TARGETDURATION:(\d+)/m)?.[1] ?? 4) * 1000));
      const refreshAt = !master && text.includes('#EXT-X-ENDLIST') ? Infinity : Date.now() + (master ? 60000 : Math.max(500, Math.min(6000, targetMs / 2)));
      const snapshot = { text, refreshAt, targetMs, master };
      this.manifests.set(uri, snapshot); if (!cached || cached.text !== text) this.core.observePlaylist(uri, text);
      return snapshot;
    } finally { clearTimeout(timeout); if (this.request === controller) this.request = undefined; }
  }
  private targetsForCycle() {
    const positions = this.positions.length ? this.positions : [0];
    const selected = Array.from({ length: Math.min(8, positions.length) }, (_, index) => positions[(this.cursor + index) % positions.length] ?? 0);
    this.cursor = (this.cursor + selected.length) % positions.length; return selected;
  }
  private async cycle() {
    try {
      if (this.paused) { this.schedule(); return; }
      const root = absoluteUrl(this.playback.url); const rootSnapshot = await this.manifest(root);
      const lines = rootSnapshot.text.split(/\r?\n/).map((line) => line.trim()); const variants: string[] = [];
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]; const next = lines[index + 1];
        if (line?.startsWith('#EXT-X-STREAM-INF:') && next && !next.startsWith('#')) variants.push(new URL(next, root).href);
        if (line?.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) { const uri = line.match(/URI="([^"]+)"/)?.[1]; if (uri) variants.push(new URL(uri, root).href); }
      }
      const playlists = variants.length ? [...new Set(variants)].slice(0, 8) : [root]; let loaded = false; const warmed = new Set<number>();
      for (const uri of playlists) {
        if (this.closed || this.paused) break;
        const snapshot = uri === root ? rootSnapshot : await this.manifest(uri);
        this.freshnessMs = Math.max(15000, snapshot.targetMs * 3);
        const segments = this.core.seedSegments(uri); const selected = new Set<number>(); const targets = this.targetsForCycle(); const completed = new Set<number>();
        for (const position of targets) {
          const index = segments.findIndex((segment) => segment.endTime > position);
          if (index >= 0) for (let next = index; next < Math.min(segments.length, index + 3); next++) selected.add(next);
        }
        if (this.playback.isLive) for (let index = Math.max(0, segments.length - 4); index < segments.length; index++) selected.add(index);
        for (const index of [...selected].slice(0, 24)) {
          if (this.closed || this.paused) break;
          const segment = segments[index]; if (!segment) continue;
          if (this.core.hasCachedSeedSegment(uri, segment)) { completed.add(index); this.statusValue.lastSegmentAt = Math.max(this.statusValue.lastSegmentAt, this.core.cachedSeedSegmentStoredAt(uri, segment) ?? 0); continue; }
          const range = segment.byteRange;
          const bytes = await this.core.load(segment.url, range?.start ?? 0, range ? range.end - range.start + 1 : -1);
          if (bytes && this.core.hasCachedSeedSegment(uri, segment)) { completed.add(index); this.statusValue.lastSegmentAt = Math.max(this.statusValue.lastSegmentAt, this.core.cachedSeedSegmentStoredAt(uri, segment) ?? 0); this.statusValue.loads++; }
        }
        if (selected.size > 0 && completed.size === selected.size) loaded = true;
        for (const position of targets) if (completed.has(segments.findIndex((segment) => segment.endTime > position))) warmed.add(position);
        this.statusValue.positions = [...warmed]; this.statusValue.ready = loaded;
      }
      this.statusValue.positions = [...warmed]; this.statusValue.ready = loaded;
    } catch {
      this.statusValue.ready = false;
      if (!this.closed && !this.paused) { this.statusValue.failures++; this.manifests.clear(); }
    }
    this.schedule();
  }
  private schedule() { if (!this.closed) this.timer = setTimeout(() => { void this.cycle(); }, 1000); }
}
