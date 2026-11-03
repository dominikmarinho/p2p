import { NativeSegmentCore } from './native-core.js';
import type { Playback } from '../api.js';

export interface AndroidBridgeApi { init(playback: Playback, enabled: boolean): void; playlist(uri: string, text: string): void; load(id: string, uri: string, position: number, length: number): void; http(bytes: number): void; destroy(): void }

declare global {
  interface Window {
    NativeSegments?: { ready(): void; complete(id: string, chunk: string, done: boolean): void; fallback(id: string): void; stats(json: string): void };
    HighpassBridge: AndroidBridgeApi;
  }
}
let core: NativeSegmentCore | undefined;
window.HighpassBridge = {
  init: (playback, enabled) => { core?.destroy(); core = new NativeSegmentCore(playback, enabled, (stats) => window.NativeSegments?.stats(JSON.stringify(stats))); },
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
  http: (bytes) => core?.addHttp(bytes),
  destroy: () => { core?.destroy(); core = undefined; },
};
window.NativeSegments?.ready();
