import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { HlsJsP2PEngine } from 'p2p-media-loader-hlsjs';
import { absoluteUrl, trackerUrl, type Playback } from '../api';
import type { CoreEventMap } from 'p2p-media-loader-core';
import { PlaybackReporter } from '../p2p/telemetry';
import { DeliveryPolicy } from '../p2p/delivery-policy';
import { initialStats, trackStats, trafficPercentages } from '../p2p/stats';

export function formatBytes(value: number): string { if (value < 1024) return `${Math.round(value)} B`; if (value >= 1073741824) return `${(value / 1073741824).toFixed(2)} GB`; if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1048576).toFixed(1)} MB`; }

export function P2PVideoPlayer({ playback, title, enabled = true }: { playback: Playback; title: string; enabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null); const [stats, setStats] = useState(initialStats); const [error, setError] = useState(''); const [native, setNative] = useState(false); const [contingency, setContingency] = useState(false);
  useEffect(() => {
    const element = video.current; if (!element) return;
    setStats({ ...initialStats }); setError(''); setNative(false); setContingency(false);
    let hls: Hls | undefined; let destroyStats = () => {}; let carried = { ...initialStats }; let snapshot = () => ({ ...carried });
    let restorePosition: (() => void) | undefined; let fileMode = false; let recoverFile = false; let probing = false; let closed = false;
    let updateHttp: (allowed: boolean) => void = () => {};
    const p2pEnabled = (enabled || Boolean(playback.delivery)) && typeof RTCPeerConnection !== 'undefined' && Hls.isSupported();
    const policy = p2pEnabled && playback.delivery ? new DeliveryPolicy(playback, (allowed) => { updateHttp(allowed); setContingency(allowed); }) : undefined;
    const reporter = new PlaybackReporter(playback, 'web', () => snapshot());
    const playhead = () => policy?.playhead(element.currentTime); element.addEventListener('timeupdate', playhead);
    const serverStats = () => {
      let cancelled = false;
      const timer = setInterval(() => { if (playback.statsPath) void fetch(absoluteUrl(playback.statsPath), { credentials: 'same-origin' }).then(async (response) => {
        if (!response.ok) return; const value = await response.json() as Partial<typeof initialStats>;
        if (!cancelled) { const httpDownloaded = Math.max(value.httpDownloaded ?? 0, carried.httpDownloaded); const split = trafficPercentages(httpDownloaded, carried.p2pDownloaded); carried = { ...carried, deliveryMode: httpDownloaded > 0 ? 'http' : 'connecting', peers: 0, httpDownloaded, ...split, saving: split.p2pPercentage, downloadRate: 0, uploadRate: 0 }; setStats({ ...carried }); }
      }).catch(() => undefined); }, 1000);
      snapshot = () => ({ ...carried }); return () => { cancelled = true; clearInterval(timer); };
    };
    const boot = (position = playback.isLive ? -1 : 0) => {
      if (closed) return;
      fileMode = false; recoverFile = false; setError(''); setNative(!p2pEnabled); policy?.reset(); destroyStats();
      const HlsWithP2P = HlsJsP2PEngine.injectMixin(Hls);
      const instance = new HlsWithP2P({ enableWorker: true, startPosition: position, maxBufferLength: playback.config?.bufferSeconds ?? 20, backBufferLength: 15, p2p: { core: { swarmId: playback.swarmId, announceTrackers: [trackerUrl(playback.trackerPath)], segmentMemoryStorageLimit: 64, p2pMaxPeers: playback.config?.maxConnectionsPerNode ?? 6, webRtcOffersCount: 3, httpDownloadInitialTimeoutMs: 0, highDemandTimeWindow: 2, httpDownloadTimeWindow: 8, p2pDownloadTimeWindow: 120, simultaneousHttpDownloads: policy && !policy.httpAllowed ? 0 : 1, rtcConfig: { iceServers: playback.iceServers }, isP2PDisabled: !p2pEnabled } } });
      hls = instance; updateHttp = (allowed) => { instance.p2pEngine.applyDynamicConfig({ core: { simultaneousHttpDownloads: allowed ? 1 : 0 } });  };
      const downloaded: CoreEventMap['onSegmentLoaded'] = ({ downloadSource, segment }) => { if (downloadSource === 'p2p') policy?.recovered(segment.url); };
      instance.p2pEngine.addEventListener('onSegmentLoaded', downloaded);
      if (p2pEnabled) { const tracker = trackStats(instance.p2pEngine, setStats, carried); snapshot = tracker.snapshot; destroyStats = () => { tracker.destroy(); instance.p2pEngine.removeEventListener('onSegmentLoaded', downloaded); }; }
      else destroyStats = serverStats();
      instance.on(Hls.Events.FRAG_LOADING, (_event, data) => { if (data.frag.url) { policy?.begin(data.frag.url, data.frag.start); } });
      instance.on(Hls.Events.FRAG_LOADED, (_event, data) => { if (data.frag.url) policy?.finish(data.frag.url); });
      instance.on(Hls.Events.MEDIA_ATTACHED, () => instance.loadSource(absoluteUrl(playback.url)));
      instance.on(Hls.Events.MANIFEST_PARSED, () => { void element.play().catch(() => setError('Pressione reproduzir para iniciar.')); });
      let networkRetries = 0; let mediaRetries = 0;
      instance.on(Hls.Events.ERROR, (_event, data) => {
        window.dispatchEvent(new CustomEvent('highpass:playback-error', { detail: { type: data.type, code: data.details, fatal: data.fatal } }));
        if (!data.fatal || closed) return;
        if (playback.directUrl && playback.directUrl !== playback.url) {
          const at = element.currentTime; carried = snapshot(); destroyStats(); updateHttp = () => {}; policy?.reset(); instance.destroy(); hls = undefined;
          fileMode = true; recoverFile = data.type === Hls.ErrorTypes.NETWORK_ERROR; setNative(true); setContingency(true); setError(''); destroyStats = serverStats();
          restorePosition = () => { if (at > 0 && Number.isFinite(element.duration)) element.currentTime = Math.min(at, Math.max(0, element.duration - 1)); setError(''); void element.play().catch(() => setError('Pressione reproduzir para iniciar.')); };
          element.addEventListener('loadedmetadata', restorePosition, { once: true }); element.src = absoluteUrl(playback.directUrl); element.load();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) { policy?.fallback(); instance.startLoad(); }
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) instance.recoverMediaError();
        else { setError('Não foi possível reproduzir. Troque de canal ou entre novamente.'); instance.destroy(); }
      });
      instance.attachMedia(element);
    };
    if (playback.isHls && Hls.isSupported()) boot();
    else { setNative(true); destroyStats = serverStats(); element.src = absoluteUrl(playback.url); void element.play().catch(() => setError('Pressione reproduzir para iniciar.')); }
    const recovery = setInterval(() => {
      if (!fileMode || !recoverFile || probing || closed) return; probing = true;
      void fetch(absoluteUrl(playback.url), { credentials: 'same-origin', signal: AbortSignal.timeout(5000) }).then(async (response) => {
        if (!response.ok || !(await response.text()).trimStart().startsWith('#EXTM3U') || closed) return;
        const at = element.currentTime; carried = snapshot(); if (restorePosition) { element.removeEventListener('loadedmetadata', restorePosition); restorePosition = undefined; } boot(at);
      }).catch(() => undefined).finally(() => { probing = false; });
    }, 15000);
    return () => { reporter.destroy(); closed = true; clearInterval(recovery); element.removeEventListener('timeupdate', playhead); if (restorePosition) element.removeEventListener('loadedmetadata', restorePosition); policy?.destroy(); destroyStats(); hls?.destroy(); element.pause(); element.removeAttribute('src'); element.load(); };
  }, [playback, enabled]);
  const p2pDisplay = Math.round(stats.p2pPercentage * 10) / 10; const httpDisplay = stats.totalDownloaded > 0 ? 100 - p2pDisplay : 0;
  const active = (enabled || Boolean(playback.delivery)) && !native && typeof RTCPeerConnection !== 'undefined';
  return <section className="video-shell" aria-label={`Reproduzindo ${title}`}>
    <video ref={video} controls autoPlay playsInline onError={() => setError('Formato ou origem indisponível neste dispositivo.')} />
    <div className="video-top"><span className="live-pill">{playback.isLive ? '● AO VIVO' : 'SOB DEMANDA'}</span><span>{title}</span></div>
    {error && <div className="player-message" role="status">{error}</div>}
    <div className="traffic-overlay" aria-label="Distribuição do tráfego" data-mode={stats.deliveryMode}>
      <span className={stats.deliveryMode === 'p2p' ? 'p2p-active' : ''}>● {active ? stats.deliveryMode === 'p2p' ? 'P2P ativo' : stats.deliveryMode === 'http' ? 'HTTP de contingência · buscando P2P' : contingency ? 'Conectando · HTTP disponível' : 'Conectando ao P2P' : 'HTTP'}</span>
      <span>HTTP <b data-testid="http-percentage">{httpDisplay.toFixed(1)}%</b></span><span>P2P <b data-testid="p2p-percentage">{p2pDisplay.toFixed(1)}%</b></span><span>{stats.peers} peers</span><span>↓ {formatBytes(stats.downloadRate)}/s P2P</span><span>↑ {formatBytes(stats.uploadRate)}/s</span><span>{formatBytes(stats.totalDownloaded)}</span>
    </div>
  </section>;
}
