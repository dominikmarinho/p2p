import { NativeSegmentCore } from './native-core.js';
import type { Playback } from '../api.js';
import { BrowserSeed } from './browser-seed.js';

export interface AndroidBridgeApi { init(playback: Playback, enabled: boolean, seeder?: boolean): void; playlist(uri: string, text: string): void; load(id: string, uri: string, position: number, length: number): void; http(bytes: number): void; httpOnly(): void; resume(): void; playhead(position: number): void; seedTargets(positions: number[]): void; seedStatus(): { ready: boolean; lastSegmentAt: number; loads: number; failures: number; positions: number[] } | undefined; destroy(): void }

declare global {
  interface Window {
    NativeSegments?: { ready(): void; complete(id: string, chunk: string, done: boolean): void; fallback(id: string): void; stats(json: string): void };
    HighpassBridge: AndroidBridgeApi;
  }
}
let core: NativeSegmentCore | undefined;
let seed: BrowserSeed | undefined;
window.HighpassBridge = {
  init: (playback, enabled, seeder = false) => { seed?.close(); seed = undefined; core?.destroy(); core = new NativeSegmentCore(playback, enabled, (stats) => window.NativeSegments?.stats(JSON.stringify(stats)), seeder); if (seeder) seed = new BrowserSeed(core, playback); },
  playlist: (uri, text) => core?.observePlaylist(uri, text),
  load: (id, uri, position, length) => {
    if (!core) { window.NativeSegments?.fallback(id); return; }
    void core.load(uri, position, length).then((buffer) => {
      if (!buffer || buffer.byteLength === 0 || buffer.byteLength > 16 * 1024 * 1024) { window.NativeSegments?.fallback(id); return; }
      const bytes = new Uint8Array(buffer);
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        const part = bytes.subarray(offset, offset + 32768); let raw = ''; for (const byte of part) raw += String.fromCharCode(byte);
        window.NativeSegments?.complete(id, btoa(raw), offset + part.length === bytes.length);
      }
    }).catch(() => window.NativeSegments?.fallback(id));
  },
  httpOnly: () => core?.httpOnly(),
  resume: () => core?.resume(),
  playhead: (position) => core?.playhead(position),
  seedTargets: (positions) => seed?.targets(positions),
  seedStatus: () => seed?.status(),
  http: (bytes) => core?.addHttp(bytes),
  destroy: () => { seed?.close(); seed = undefined; core?.destroy(); core = undefined; },
};
window.NativeSegments?.ready();
