import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { HlsJsP2PEngine } from 'p2p-media-loader-hlsjs';
import { absoluteUrl, trackerUrl, type Playback } from '../api';
import { initialStats, trackStats } from '../p2p/stats';

export function formatBytes(value: number): string { if (value < 1024) return `${Math.round(value)} B`; if (value >= 1073741824) return `${(value / 1073741824).toFixed(2)} GB`; if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1048576).toFixed(1)} MB`; }

export function P2PVideoPlayer({ playback, title, enabled = true }: { playback: Playback; title: string; enabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null); const [stats, setStats] = useState(initialStats); const [error, setError] = useState(''); const [native, setNative] = useState(false);
  useEffect(() => {
    const element = video.current; if (!element) return;
    setStats({ ...initialStats }); setError(''); setNative(false); let hls: Hls | undefined; let destroyStats = () => {}; let networkRetries = 0; let mediaRetries = 0;
    const serverStats = () => {
      let cancelled = false;
      const timer = setInterval(() => { if (playback.statsPath) void fetch(playback.statsPath, { credentials: 'same-origin' }).then(async (response) => { if (!response.ok) return; const value = await response.json() as Partial<typeof initialStats>; if (!cancelled) setStats({ ...initialStats, ...value }); }).catch(() => undefined); }, 1000);
      return () => { cancelled = true; clearInterval(timer); };
    };
    if (playback.isHls && Hls.isSupported()) {
      const HlsWithP2P = HlsJsP2PEngine.injectMixin(Hls);
      const instance = new HlsWithP2P({ enableWorker: true, startPosition: playback.isLive ? -1 : 0, maxBufferLength: playback.config?.bufferSeconds ?? 20, backBufferLength: 15, p2p: { core: { swarmId: playback.swarmId, announceTrackers: [trackerUrl(playback.trackerPath)], segmentMemoryStorageLimit: 64, p2pMaxPeers: playback.config?.maxConnectionsPerNode ?? 6, webRtcOffersCount: 3, httpDownloadInitialTimeoutMs: 1200, highDemandTimeWindow: 2, httpDownloadTimeWindow: 8, p2pDownloadTimeWindow: 120, simultaneousHttpDownloads: 1, rtcConfig: { iceServers: playback.iceServers }, isP2PDisabled: !enabled || typeof RTCPeerConnection === 'undefined' } } });
      hls = instance;
      if (enabled && typeof RTCPeerConnection !== 'undefined') { const tracker = trackStats(instance.p2pEngine, setStats); destroyStats = tracker.destroy; } else { setNative(true); destroyStats = serverStats(); }
      instance.on(Hls.Events.MEDIA_ATTACHED, () => instance.loadSource(absoluteUrl(playback.url)));
      instance.on(Hls.Events.MANIFEST_PARSED, () => { void element.play().catch(() => setError('Pressione reproduzir para iniciar.')); });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) instance.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) instance.recoverMediaError();
        else { setError('Não foi possível reproduzir. Troque de canal ou entre novamente.'); instance.destroy(); }
      });
      instance.attachMedia(element);
    } else {
      setNative(true); destroyStats = serverStats(); element.src = absoluteUrl(playback.url); void element.play().catch(() => setError('Pressione reproduzir para iniciar.'));
    }
    return () => { destroyStats(); hls?.destroy(); element.pause(); element.removeAttribute('src'); element.load(); };
  }, [playback, enabled]);
  const p2pDisplay = Math.round(stats.p2pPercentage * 10) / 10; const httpDisplay = stats.totalDownloaded > 0 ? 100 - p2pDisplay : 0;
  const active = enabled && !native && typeof RTCPeerConnection !== 'undefined';
  return <section className="video-shell" aria-label={`Reproduzindo ${title}`}>
    <video ref={video} controls autoPlay playsInline onError={() => setError('Formato ou origem indisponível neste dispositivo.')} />
    <div className="video-top"><span className="live-pill">{playback.isLive ? '● AO VIVO' : 'SOB DEMANDA'}</span><span>{title}</span></div>
    {error && <div className="player-message" role="status">{error}</div>}
    <div className="traffic-badge" aria-label="Distribuição do tráfego"><strong>{stats.totalDownloaded > 0 ? 'TRÁFEGO DE VÍDEO' : 'AGUARDANDO DADOS'}</strong><span>HTTP <b data-testid="http-percentage">{httpDisplay.toFixed(1)}%</b></span><span>P2P <b data-testid="p2p-percentage">{p2pDisplay.toFixed(1)}%</b></span><span>{stats.peers} peers · {formatBytes(stats.totalDownloaded)}</span></div>
    <div className="p2p-strip"><span className={stats.peers ? 'p2p-active' : ''}>● {active ? stats.peers ? 'P2P conectado' : 'P2P aguardando peers' : 'Reprodução HTTP'}</span><span>{stats.peers} peers</span><span>↓ {formatBytes(stats.downloadRate)}/s P2P</span><span>↑ {formatBytes(stats.uploadRate)}/s</span><span>{stats.saving.toFixed(1)}% de economia</span>{active && <span className="total-data">HTTP {formatBytes(stats.httpDownloaded)} · P2P {formatBytes(stats.p2pDownloaded)}</span>}</div>
  </section>;
}
