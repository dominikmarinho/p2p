import { Core, CoreRequestError, type CoreEventMap, type Segment, type StreamProperties } from 'p2p-media-loader-core';
import { resilientP2P, exclusiveSegmentDeadlineMs } from './network-profile.js';
import { PlaybackReporter } from './telemetry.js';
import { DeliveryPolicy } from './delivery-policy.js';
import { SeedSegmentStorage } from './seed-storage.js';
import type { Playback } from '../api.js';
import { absoluteUrl, trackerUrl } from '../api.js';
import { trackStats, type P2PStats } from './stats.js';

const attrs = (line: string): Record<string, string> => Object.fromEntries(Array.from(line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g), (match) => [match[1], match[2] ?? match[3]]));
const runtimeId = (url: string, start?: number, end?: number) => start !== undefined && end !== undefined ? `${url}|${start}-${end}` : url;

export class NativeSegmentCore {
  readonly core: Core;
  private httpMode = false;
  private readonly reporter: PlaybackReporter | undefined;
  private readonly segmentTimes = new Map<string, number>();
  private readonly playlists = new Map<string, Segment[]>();
  private readonly policy: DeliveryPolicy | undefined;
  private readonly retryPeerFailures: boolean;
  private readonly seedStorage: SeedSegmentStorage | undefined;
  private readonly downloaded: CoreEventMap['onSegmentLoaded'] = ({ downloadSource, segment }) => { if (downloadSource === 'p2p') this.policy?.recovered(segment.runtimeId); };
  private readonly stats;
  private readonly streams = new Map<string, StreamProperties>();
  constructor(private readonly playback: Playback, enabled: boolean, onStats: (stats: P2PStats) => void, seeder = false) {
    enabled = enabled || Boolean(playback.delivery);
    this.retryPeerFailures = enabled && !seeder;
    this.seedStorage = seeder ? new SeedSegmentStorage() : undefined;
    this.core = new Core({ swarmId: playback.swarmId, announceTrackers: [trackerUrl(playback.trackerPath)], segmentMemoryStorageLimit: 64, ...(this.seedStorage ? { customSegmentStorageFactory: () => this.seedStorage! } : {}), p2pMaxPeers: playback.config?.maxConnectionsPerNode ?? 6, webRtcOffersCount: 3, httpDownloadInitialTimeoutMs: enabled && !seeder && !playback.delivery ? 1200 : 0, highDemandTimeWindow: 2, httpDownloadTimeWindow: 8, ...resilientP2P, simultaneousHttpDownloads: !seeder && playback.transport === 'p2p' ? 0 : 1, rtcConfig: { iceServers: playback.iceServers }, isP2PDisabled: !enabled });
    this.core.setManifestResponseUrl(absoluteUrl(playback.url)); this.core.setIsLive(playback.isLive); this.stats = trackStats(this.core, onStats); this.reporter = seeder ? undefined : new PlaybackReporter(playback, 'bridge', this.stats.snapshot);
    this.policy = !seeder && playback.delivery && enabled ? new DeliveryPolicy(playback, (allowed) => { if (!this.httpMode) { this.core.applyDynamicConfig({ simultaneousHttpDownloads: allowed ? 1 : 0 }); } }) : undefined;
    this.core.addEventListener('onSegmentLoaded', this.downloaded);
  }
  observePlaylist(uri: string, text: string): void {
    if (this.httpMode) return;
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
    this.playlists.set(uri, segments);
    for (const segment of segments) this.segmentTimes.set(segment.runtimeId, segment.startTime);
    for (const id of current) if (!next.has(id)) this.segmentTimes.delete(id);
    this.core.updateStream(uri, segments.filter((segment) => !current.has(segment.runtimeId)), [...current].filter((id) => !next.has(id)));
    if (this.playback.isLive) this.core.updatePlayback(segments[0]?.startTime ?? 0, 1);
  }
  async load(url: string, position: number, length: number): Promise<ArrayBuffer | null> {
    if (this.httpMode) return null;
    if (position > 0 && length <= 0) return null;
    const id = runtimeId(url, position > 0 || length > 0 ? position : undefined, length > 0 ? position + length - 1 : undefined);
    const playhead = this.segmentTimes.get(id);
    if (playhead !== undefined) this.core.updatePlayback(playhead, 1);
    if (!this.core.hasSegment(id) || !this.core.isSegmentLoadable(id)) return null;
    if (!this.policy && this.retryPeerFailures) this.core.applyDynamicConfig({ simultaneousHttpDownloads: 1 });
    this.policy?.begin(id, playhead ?? 0);
    return new Promise<ArrayBuffer>((resolve, reject) => {
      let settled = false; let retry: ReturnType<typeof setTimeout> | undefined;
      const finish = () => { settled = true; clearTimeout(timer); if (retry) clearTimeout(retry); this.policy?.finish(id); };
      const timer = setTimeout(() => { this.core.abortSegmentLoading(id); finish(); reject(new Error('P2P timeout')); }, this.playback.transport === 'p2p' ? exclusiveSegmentDeadlineMs : 12000);
      const failed = (error: unknown) => {
        if (settled) return;
        if (this.retryPeerFailures && !this.httpMode && !(error instanceof CoreRequestError && error.type === 'aborted')) {
          // A refused HTTP attempt must not tear down peer discovery during
          // the ICE handshake. Retry the same request within its watchdog.
          if (this.stats.snapshot().peers > 0) { if (this.policy) this.policy.retryP2P(); else this.core.applyDynamicConfig({ simultaneousHttpDownloads: 0 }); }
          retry ??= setTimeout(() => { retry = undefined; request(); }, 250); return;
        }
        finish(); reject(error instanceof Error ? error : new Error('Falha P2P'));
      };
      const request = () => { if (!settled) void this.core.loadSegment(id, { onSuccess: (result) => { if (!settled) { finish(); resolve(result.data); } }, onError: failed }).catch(failed); };
      request();
    });
  }
  addHttp(bytes: number) { this.stats.addHttp(bytes); }
  seedSegments(uri: string) { return this.playlists.get(uri) ?? []; }
  hasCachedSeedSegment(uri: string, segment: Segment) {
    const stream = this.core.getStream(uri);
    return stream !== undefined && this.seedStorage?.hasSegment(this.playback.swarmId, stream.streamSwarmId, segment.externalId) === true;
  }
  cachedSeedSegmentStoredAt(uri: string, segment: Segment) {
    const stream = this.core.getStream(uri);
    return stream ? this.seedStorage?.segmentStoredAt(this.playback.swarmId, stream.streamSwarmId, segment.externalId) : undefined;
  }
  playhead(position: number) { this.policy?.playhead(position); }
  httpOnly() { if (this.playback.transport === 'p2p') return; if (!this.httpMode) { this.httpMode = true; this.stats.clearPeers(); this.core.applyDynamicConfig({ isP2PDisabled: true, simultaneousHttpDownloads: 0 }); } }
  resume() { if (this.httpMode) { this.httpMode = false; this.core.applyDynamicConfig({ isP2PDisabled: false, simultaneousHttpDownloads: this.policy ? 0 : 1 }); } }
  destroy() { this.reporter?.destroy(); this.policy?.destroy(); this.core.removeEventListener('onSegmentLoaded', this.downloaded); this.segmentTimes.clear(); this.playlists.clear(); this.stats.destroy(); this.core.destroy(); }
}
