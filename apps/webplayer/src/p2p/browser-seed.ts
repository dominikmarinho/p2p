import type { Playback } from '../api.js';
import { absoluteUrl } from '../api.js';
import type { NativeSegmentCore } from './native-core.js';

export class BrowserSeed {
  private positions: number[] = [0];
  private closed = false;
  private cursor = 0;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private statusValue = { ready: false, lastSegmentAt: 0, loads: 0, failures: 0, positions: [] as number[] };
  constructor(private readonly core: NativeSegmentCore, private readonly playback: Playback) { void this.cycle(); }
  targets(positions: number[]) { this.positions = positions.filter(Number.isFinite).slice(0, 32); this.paused = !this.positions.length; }
  status() { return { ...this.statusValue, ready: this.statusValue.ready && Date.now() - this.statusValue.lastSegmentAt < 15000 }; }
  close() { this.closed = true; if (this.timer) clearTimeout(this.timer); }
  private async manifest(uri: string) {
    const response = await fetch(uri, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Manifest indisponível');
    const reader = response.body?.getReader(); if (!reader) throw new Error('Manifest vazio');
    const parts: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1024 * 1024) throw new Error('Manifest excedeu limite'); parts.push(part.value); } }
    finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const text = new TextDecoder().decode(bytes);
    if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Manifest inválido');
    this.core.observePlaylist(uri, text); return text;
  }
  private targetsForCycle() {
    const positions = this.positions.length ? this.positions : [0];
    const selected = Array.from({ length: Math.min(8, positions.length) }, (_, index) => positions[(this.cursor + index) % positions.length] ?? 0);
    this.cursor = (this.cursor + selected.length) % positions.length; return selected;
  }
  private async cycle() {
    try {
      if (this.paused) { this.timer = setTimeout(() => { void this.cycle(); }, 1000); return; }
      const root = absoluteUrl(this.playback.url); const text = await this.manifest(root);
      const lines = text.split(/\r?\n/).map((line) => line.trim()); const variants: string[] = [];
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]; const next = lines[index + 1];
        if (line?.startsWith('#EXT-X-STREAM-INF:') && next && !next.startsWith('#')) variants.push(new URL(next, root).href);
        if (line?.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) { const uri = line.match(/URI="([^"]+)"/)?.[1]; if (uri) variants.push(new URL(uri, root).href); }
      }
      const playlists = variants.length ? [...new Set(variants)].slice(0, 8) : [root]; let loaded = false; const warmed = new Set<number>();
      for (const uri of playlists) {
        if (this.closed) return;
        if (uri !== root) await this.manifest(uri);
        const segments = this.core.seedSegments(uri); const selected = new Set<number>(); const targets = this.targetsForCycle(); const completed = new Set<number>();
        if (this.playback.isLive) for (let index = Math.max(0, segments.length - 4); index < segments.length; index++) selected.add(index);
        else for (const position of targets) {
          const index = segments.findIndex((segment) => segment.endTime > position);
          if (index >= 0) for (let next = index; next < Math.min(segments.length, index + 3); next++) selected.add(next);
        }
        for (const index of [...selected].slice(0, 24)) {
          if (this.closed) return;
          const segment = segments[index]; if (!segment) continue;
          const range = segment.byteRange;
          const bytes = await this.core.load(segment.url, range?.start ?? 0, range ? range.end - range.start + 1 : -1);
          if (bytes) { completed.add(index); loaded = true; this.statusValue.lastSegmentAt = Date.now(); this.statusValue.loads++; }
        }
        for (const position of targets) if (completed.has(segments.findIndex((segment) => segment.endTime > position))) warmed.add(position);
      }
      this.statusValue.positions = [...warmed]; this.statusValue.ready = loaded;
    } catch { this.statusValue.ready = false; this.statusValue.failures++; }
    if (!this.closed) this.timer = setTimeout(() => { void this.cycle(); }, 1000);
  }
}
