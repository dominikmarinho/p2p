import { Core, type Segment, type StreamProperties } from 'p2p-media-loader-core';
import type { Playback } from '../api.js';
import { absoluteUrl, trackerUrl } from '../api.js';
import { trackStats, type P2PStats } from './stats.js';

const attrs = (line: string): Record<string, string> => Object.fromEntries(Array.from(line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g), (match) => [match[1], match[2] ?? match[3]]));
const runtimeId = (url: string, start?: number, end?: number) => start !== undefined && end !== undefined ? `${url}|${start}-${end}` : url;

export class NativeSegmentCore {
  readonly core: Core;
  private readonly stats;
  private readonly streams = new Map<string, StreamProperties>();
  constructor(private readonly playback: Playback, enabled: boolean, onStats: (stats: P2PStats) => void) {
    this.core = new Core({ swarmId: playback.swarmId, announceTrackers: [trackerUrl(playback.trackerPath)], segmentMemoryStorageLimit: 32, p2pMaxPeers: playback.config?.maxConnectionsPerNode ?? 6, webRtcOffersCount: 3, httpDownloadInitialTimeoutMs: 1200, highDemandTimeWindow: 2, httpDownloadTimeWindow: 8, p2pDownloadTimeWindow: 120, simultaneousHttpDownloads: 1, rtcConfig: { iceServers: playback.iceServers }, isP2PDisabled: !enabled });
    this.core.setManifestResponseUrl(absoluteUrl(playback.url)); this.core.setIsLive(playback.isLive); this.stats = trackStats(this.core, onStats);
  }
  observePlaylist(uri: string, text: string): void {
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    if (!lines.some((line) => line === '#EXTM3U')) return;
    if (lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:'))) {
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]; const next = lines[index + 1]; if (!line?.startsWith('#EXT-X-STREAM-INF:') || !next || next.startsWith('#')) continue;
        const data = attrs(line); const resolution = (data.RESOLUTION ?? '0x0').split('x');
        const codecs = data.CODECS?.split(',').find((codec) => /^(avc|hvc|hev|av01|vp0?9|vp8)/i.test(codec));
        const properties: StreamProperties = { bitrate: Number(data.BANDWIDTH ?? 0), width: Number(resolution[0]), height: Number(resolution[1]), ...(codecs ? { codecs } : {}), ...(data['FRAME-RATE'] ? { frameRate: data['FRAME-RATE'] } : {}), ...(data['VIDEO-RANGE'] ? { videoRange: data['VIDEO-RANGE'] } : {}) };
        const url = new URL(next, uri).href; this.streams.set(url, properties); this.core.addStreamIfNoneExists({ runtimeId: url, type: 'main', properties });
      }
      for (const line of lines.filter((entry) => entry.startsWith('#EXT-X-MEDIA:'))) {
        const data = attrs(line); if (data.TYPE !== 'AUDIO' || !data.URI) continue;
        const url = new URL(data.URI, uri).href;
        const properties: StreamProperties = { bitrate: 0, ...(data.LANGUAGE ? { language: data.LANGUAGE } : {}), ...(data.CHANNELS ? { channels: data.CHANNELS } : {}), ...(data.NAME ? { name: data.NAME } : {}) };
        this.streams.set(url, properties); this.core.addStreamIfNoneExists({ runtimeId: url, type: 'secondary', properties });
      }
      return;
    }
    const isLive = this.playback.isLive; this.core.setIsLive(isLive);
    if (!this.core.getStream(uri)) this.core.addStreamIfNoneExists({ runtimeId: uri, type: 'main', properties: this.streams.get(uri) ?? { bitrate: 0 } });
    let sequence = Number(lines.find((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))?.split(':')[1] ?? 0); let duration = 0; let time = 0; let offset = 0; let range: { start: number; end: number } | undefined;
    const segments: Segment[] = [];
    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]);
      else if (line.startsWith('#EXT-X-BYTERANGE:')) { const [length, start] = line.slice(17).split('@'); const begin = start === undefined ? offset : Number(start); range = { start: begin, end: begin + Number(length) - 1 }; offset = range.end + 1; }
      else if (line && !line.startsWith('#') && duration > 0) {
        const url = new URL(line, uri).href;
        segments.push({ runtimeId: runtimeId(url, range?.start, range?.end), externalId: isLive ? sequence++ : segments.length, url, ...(range ? { byteRange: range } : {}), startTime: time, endTime: time + duration }); time += duration; duration = 0; range = undefined;
      }
    }
    const current = this.core.getStreamSegmentRuntimeIds(uri) ?? new Set<string>(); const next = new Set(segments.map((segment) => segment.runtimeId));
    this.core.updateStream(uri, segments.filter((segment) => !current.has(segment.runtimeId)), [...current].filter((id) => !next.has(id)));
    this.core.updatePlayback(segments[0]?.startTime ?? 0, 1);
  }
  async load(url: string, position: number, length: number): Promise<ArrayBuffer | null> {
    if (position > 0 && length <= 0) return null;
    const id = runtimeId(url, position > 0 || length > 0 ? position : undefined, length > 0 ? position + length - 1 : undefined);
    if (!this.core.hasSegment(id) || !this.core.isSegmentLoadable(id)) return null;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(() => { this.core.abortSegmentLoading(id); reject(new Error('P2P timeout')); }, 12000);
      void this.core.loadSegment(id, { onSuccess: (result) => { clearTimeout(timer); resolve(result.data); }, onError: (error) => { clearTimeout(timer); reject(error); } }).catch((error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error('Falha P2P')); });
    });
  }
  addHttp(bytes: number) { this.stats.addHttp(bytes); }
  destroy() { this.stats.destroy(); this.core.destroy(); }
}
