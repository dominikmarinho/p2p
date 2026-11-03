import type { Core, CoreEventMap } from 'p2p-media-loader-core';
import type { HlsJsP2PEngine } from 'p2p-media-loader-hlsjs';

export interface P2PStats { deliveryMode: 'connecting' | 'http' | 'p2p'; peers: number; httpDownloaded: number; p2pDownloaded: number; p2pUploaded: number; downloadRate: number; uploadRate: number; saving: number; httpPercentage: number; p2pPercentage: number; totalDownloaded: number }
export const initialStats: P2PStats = { deliveryMode: 'connecting', peers: 0, httpDownloaded: 0, p2pDownloaded: 0, p2pUploaded: 0, downloadRate: 0, uploadRate: 0, saving: 0, httpPercentage: 0, p2pPercentage: 0, totalDownloaded: 0 };
export function trafficPercentages(httpBytes: number, p2pBytes: number) {
  const totalDownloaded = httpBytes + p2pBytes;
  const p2pPercentage = totalDownloaded > 0 ? p2pBytes / totalDownloaded * 100 : 0;
  return { totalDownloaded, p2pPercentage, httpPercentage: totalDownloaded > 0 ? 100 - p2pPercentage : 0 };
}
type EventSource = Pick<Core | HlsJsP2PEngine, 'addEventListener' | 'removeEventListener'>;
export function trackStats(engine: EventSource, update: (stats: P2PStats) => void, initial: Partial<P2PStats> = {}) {
  const peers = new Set<string>(); const stats = { ...initialStats, ...initial, peers: 0 }; let previousDown = stats.p2pDownloaded; let previousUp = stats.p2pUploaded; let previous = performance.now();
  const connected: CoreEventMap['onPeerConnect'] = (peer) => { peers.add(peer.peerId); };
  const closed: CoreEventMap['onPeerClose'] = (peer) => { peers.delete(peer.peerId); };
  const downloaded: CoreEventMap['onChunkDownloaded'] = (bytes, source) => { stats.deliveryMode = source === 'p2p' ? 'p2p' : 'http'; if (source === 'p2p') stats.p2pDownloaded += bytes; else stats.httpDownloaded += bytes; };
  const uploaded: CoreEventMap['onChunkUploaded'] = (bytes) => { stats.p2pUploaded += bytes; };
  engine.addEventListener('onPeerConnect', connected); engine.addEventListener('onPeerClose', closed); engine.addEventListener('onChunkDownloaded', downloaded); engine.addEventListener('onChunkUploaded', uploaded);
  const timer = setInterval(() => {
    const now = performance.now(); const seconds = Math.max(.1, (now - previous) / 1000);
    stats.peers = peers.size; stats.downloadRate = (stats.p2pDownloaded - previousDown) / seconds; stats.uploadRate = (stats.p2pUploaded - previousUp) / seconds;
    Object.assign(stats, trafficPercentages(stats.httpDownloaded, stats.p2pDownloaded)); stats.saving = stats.p2pPercentage;
    update({ ...stats }); previous = now; previousDown = stats.p2pDownloaded; previousUp = stats.p2pUploaded;
  }, 1000);
  return {
    snapshot: () => ({ ...stats, peers: peers.size, ...trafficPercentages(stats.httpDownloaded, stats.p2pDownloaded) }),
    clearPeers: () => peers.clear(),
    addHttp: (bytes: number) => { stats.httpDownloaded += bytes; if (bytes > 0) stats.deliveryMode = 'http'; },
    destroy: () => { clearInterval(timer); engine.removeEventListener('onPeerConnect', connected); engine.removeEventListener('onPeerClose', closed); engine.removeEventListener('onChunkDownloaded', downloaded); engine.removeEventListener('onChunkUploaded', uploaded); },
  };
}
