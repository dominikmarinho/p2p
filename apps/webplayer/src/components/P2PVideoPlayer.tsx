import { PlaybackDiagnostics, type DiagnosticSource } from './PlaybackDiagnostics';
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { HlsJsP2PEngine } from 'p2p-media-loader-hlsjs';
import { absoluteUrl, trackerUrl, type Playback } from '../api';
import type { CoreEventMap } from 'p2p-media-loader-core';
import { PlaybackReporter } from '../p2p/telemetry';
import { DeliveryPolicy } from '../p2p/delivery-policy';
import { markStartup, failStartup } from '../p2p/startup-probe';
import { PlaybackRecovery } from '../p2p/playback-recovery';
import { livePlaybackRate } from '../p2p/live-alignment';
import { resilientP2P } from '../p2p/network-profile';
import { initialStats, trackStats, trafficPercentages } from '../p2p/stats';

export function formatBytes(value: number): string { if (value < 1024) return `${Math.round(value)} B`; if (value >= 1073741824) return `${(value / 1073741824).toFixed(2)} GB`; if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1048576).toFixed(1)} MB`; }

export function P2PVideoPlayer({ playback, title, enabled = true }: { playback: Playback; title: string; enabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null); const [stats, setStats] = useState(initialStats); const [error, setError] = useState(''); const [native, setNative] = useState(false); const [contingency, setContingency] = useState(false);
  const [trafficInside, setTrafficInside] = useState(() => { try { return localStorage.getItem('hp:traffic-position') === 'inside'; } catch { return false; } });
  const diagnosticSource = useRef<() => DiagnosticSource>(() => ({ stats: initialStats, latency: null, targetLatency: null }));
  useEffect(() => {
    const element = video.current; if (!element) return;
    setStats({ ...initialStats }); setError(''); setNative(false); setContingency(false);
    markStartup(playback.startupAttempt, 'playerCreated');
    let frameCallback: number | undefined;
    const firstFrame = () => markStartup(playback.startupAttempt, 'firstFrame', 'playing-fallback');
    if (element.requestVideoFrameCallback) frameCallback = element.requestVideoFrameCallback(() => markStartup(playback.startupAttempt, 'firstFrame', 'video-frame-callback'));
    else element.addEventListener('playing', firstFrame);
    let hls: Hls | undefined; let destroyStats = () => {}; let carried = { ...initialStats }; let snapshot = () => ({ ...carried });
    let restorePosition: (() => void) | undefined; let fileMode = false; let recoverFile = false; let probing = false; let closed = false;
    diagnosticSource.current = () => ({ stats: snapshot(), latency: hls?.latency ?? null, targetLatency: hls?.targetLatency ?? null, segment });
    let segment: DiagnosticSource['segment'];
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined; const watchdog = new PlaybackRecovery(); let offline = !navigator.onLine; let resumeAt = 0;
    let updateHttp: (allowed: boolean) => void = () => {};
    const strict = playback.transport === 'p2p';
    const p2pEnabled = playback.transport !== 'http' && (enabled || Boolean(playback.delivery)) && typeof RTCPeerConnection !== 'undefined' && Hls.isSupported();
    const policy = p2pEnabled && playback.delivery ? new DeliveryPolicy(playback, (allowed) => { updateHttp(allowed); setContingency(allowed); }) : undefined;
    const reporter = new PlaybackReporter(playback, 'web', () => snapshot());
    const playhead = () => { if (!reconnectTimer && element.readyState >= 2) resumeAt = element.currentTime; policy?.playhead(element.currentTime); }; element.addEventListener('timeupdate', playhead);
    const serverStats = () => {
      let cancelled = false;
      const timer = setInterval(() => { if (playback.statsPath) void fetch(absoluteUrl(playback.statsPath), { credentials: 'same-origin' }).then(async (response) => {
        if (!response.ok) return; const value = await response.json() as Partial<typeof initialStats>;
        if (!cancelled) { const httpDownloaded = Math.max(value.httpDownloaded ?? 0, carried.httpDownloaded); const split = trafficPercentages(httpDownloaded, carried.p2pDownloaded); carried = { ...carried, deliveryMode: httpDownloaded > 0 ? 'http' : 'connecting', peers: 0, httpDownloaded, ...split, saving: split.p2pPercentage, downloadRate: 0, uploadRate: 0 }; setStats({ ...carried }); }
      }).catch(() => undefined); }, 1000);
      snapshot = () => ({ ...carried }); return () => { cancelled = true; clearInterval(timer); };
    };
    const reconnect = () => {
      if (closed || reconnectTimer || (element.ended && !playback.isLive)) return;
      if (element.currentTime > 0) resumeAt = element.currentTime;
      carried = { ...snapshot(), deliveryMode: 'connecting', peers: 0, downloadRate: 0, uploadRate: 0 }; destroyStats(); snapshot = () => ({ ...carried }); setStats({ ...carried });
      updateHttp = () => {}; policy?.reset(); hls?.destroy(); hls = undefined;
      if (restorePosition) { element.removeEventListener('loadedmetadata', restorePosition); restorePosition = undefined; }
      const delay = watchdog.retryDelay();
      setError(`Reprodução interrompida. Reconectando em ${delay / 1000}s${strict ? ', sem HTTP para vídeo' : ''}.`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined; if (closed) return; watchdog.restarted(); const at = resumeAt;
        if (playback.isHls && Hls.isSupported()) boot(playback.isLive ? -1 : at);
        else {
          restorePosition = () => { if (!playback.isLive && at > 0 && Number.isFinite(element.duration)) element.currentTime = Math.min(at, Math.max(0, element.duration - 1)); setError(''); void element.play().catch(() => setError('Pressione reproduzir para continuar.')); };
          element.addEventListener('loadedmetadata', restorePosition, { once: true }); element.src = absoluteUrl(playback.url); element.load(); destroyStats = serverStats();
        }
      }, delay);
    };
    const mediaFailure = () => reconnect();
    const endedLive = () => { if (playback.isLive) reconnect(); };
    const wentOffline = () => { offline = true; };
    const cameOnline = () => { const wasOffline = offline; offline = false; if (wasOffline && (!element.ended || playback.isLive) && (!element.paused || element.error || reconnectTimer)) { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = undefined; reconnect(); } };
    element.addEventListener('ended', endedLive); element.addEventListener('error', mediaFailure); window.addEventListener('offline', wentOffline); window.addEventListener('online', cameOnline);
    const boot = (position = playback.isLive ? -1 : 0) => {
      if (closed) return;
      if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = undefined;
      watchdog.restarted();
      fileMode = false; recoverFile = false; setError(''); setNative(!p2pEnabled); policy?.reset(); destroyStats();
      const HlsWithP2P = HlsJsP2PEngine.injectMixin(Hls);
      const instance = new HlsWithP2P({ enableWorker: true, startPosition: position, maxBufferLength: strict ? Math.max(45, playback.config?.bufferSeconds ?? 0) : playback.config?.bufferSeconds ?? 20, backBufferLength: 30, ...(strict ? { liveSyncDurationCount: 4, liveMaxLatencyDurationCount: 8, maxLiveSyncPlaybackRate: 1, fragLoadPolicy: { default: { maxTimeToFirstByteMs: 25000, maxLoadTimeMs: 45000, timeoutRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 5000 }, errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 5000 } } } } : {}), p2p: { core: { swarmId: playback.swarmId, announceTrackers: [trackerUrl(playback.trackerPath)], segmentMemoryStorageLimit: 64, p2pMaxPeers: playback.config?.maxConnectionsPerNode ?? 6, webRtcOffersCount: 3, httpDownloadInitialTimeoutMs: p2pEnabled && !playback.delivery ? 1200 : 0, highDemandTimeWindow: 2, httpDownloadTimeWindow: 8, ...resilientP2P, simultaneousHttpDownloads: policy && !policy.httpAllowed ? 0 : 1, rtcConfig: { iceServers: playback.iceServers }, isP2PDisabled: !p2pEnabled } } });
      hls = instance; updateHttp = (allowed) => { instance.p2pEngine.applyDynamicConfig({ core: { simultaneousHttpDownloads: allowed ? 1 : 0 } });  };
      const downloaded: CoreEventMap['onSegmentLoaded'] = ({ downloadSource, segment }) => { if (downloadSource === 'p2p') { policy?.recovered(segment.url); } };
      instance.p2pEngine.addEventListener('onSegmentLoaded', downloaded);
      const peer: CoreEventMap['onPeerConnect'] = () => markStartup(playback.startupAttempt, 'peerConnected');
      const bytes: CoreEventMap['onChunkDownloaded'] = () => markStartup(playback.startupAttempt, 'firstByte');
      instance.p2pEngine.addEventListener('onPeerConnect', peer); instance.p2pEngine.addEventListener('onChunkDownloaded', bytes);
      instance.on(Hls.Events.MANIFEST_LOADED, () => markStartup(playback.startupAttempt, 'manifest'));
      if (p2pEnabled) { const tracker = trackStats(instance.p2pEngine, setStats, carried); snapshot = tracker.snapshot; destroyStats = () => { tracker.destroy(); instance.p2pEngine.removeEventListener('onPeerConnect', peer); instance.p2pEngine.removeEventListener('onChunkDownloaded', bytes); instance.p2pEngine.removeEventListener('onSegmentLoaded', downloaded); }; }
      else destroyStats = serverStats();
      instance.on(Hls.Events.FRAG_LOADING, (_event, data) => { if (data.frag.url) { policy?.begin(data.frag.url, data.frag.start); } });
      instance.on(Hls.Events.FRAG_LOADED, (_event, data) => { markStartup(playback.startupAttempt, 'firstSegment'); if (!p2pEnabled && data.frag.stats.loading.first > 0) markStartup(playback.startupAttempt, 'firstByte', undefined, data.frag.stats.loading.first); segment = Number.isFinite(data.frag.start) && data.frag.start >= 0 && Number.isFinite(data.frag.duration) && data.frag.duration >= 0 ? { sequence: String(data.frag.sn), start: data.frag.start, duration: data.frag.duration, loadMs: Math.max(0, data.frag.stats.loading.end - data.frag.stats.loading.start) } : undefined; if (data.frag.url) policy?.finish(data.frag.url); });
      instance.on(Hls.Events.MEDIA_ATTACHED, () => instance.loadSource(absoluteUrl(playback.url)));
      instance.on(Hls.Events.MANIFEST_PARSED, () => { void element.play().catch(() => setError('Pressione reproduzir para iniciar.')); });
      let networkRetries = 0; let mediaRetries = 0;
      instance.on(Hls.Events.ERROR, (_event, data) => {
        failStartup(playback.startupAttempt, data.details);
        window.dispatchEvent(new CustomEvent('highpass:playback-error', { detail: { type: data.type, code: data.details, fatal: data.fatal } }));
        if (!data.fatal || closed || hls !== instance) return;
        if (!strict && playback.directUrl && playback.directUrl !== playback.url) {
          const at = element.currentTime; carried = snapshot(); destroyStats(); updateHttp = () => {}; policy?.reset(); instance.destroy(); hls = undefined;
          fileMode = true; recoverFile = data.type === Hls.ErrorTypes.NETWORK_ERROR; setNative(true); setContingency(true); setError(''); destroyStats = serverStats();
          restorePosition = () => { if (at > 0 && Number.isFinite(element.duration)) element.currentTime = Math.min(at, Math.max(0, element.duration - 1)); setError(''); void element.play().catch(() => setError('Pressione reproduzir para iniciar.')); };
          element.addEventListener('loadedmetadata', restorePosition, { once: true }); element.src = absoluteUrl(playback.directUrl); element.load();
        } else if (!strict && data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) { policy?.fallback(); instance.startLoad(); }
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) instance.recoverMediaError();
        else reconnect();
      });
      instance.attachMedia(element);
    };
    if (strict && !p2pEnabled) setError('P2P indisponível neste dispositivo. Use um navegador com MediaSource e WebRTC.');
    else if (playback.isHls && Hls.isSupported()) boot();
    else if (strict) setError('P2P indisponível neste dispositivo. Use o cliente HTTP ou um dispositivo com WebRTC.');
    else { setNative(true); destroyStats = serverStats(); element.src = absoluteUrl(playback.url); void element.play().catch(() => setError('Pressione reproduzir para iniciar.')); }
    const alignment = setInterval(() => {
      if (watchdog.observe(element.currentTime, !element.paused && !offline, element.ended && !playback.isLive, element.seeking)) reconnect();
      if (!playback.isLive || !hls || element.paused || element.seeking) return;
      let buffered = 0;
      for (let index = 0; index < element.buffered.length; index++) if (element.buffered.start(index) <= element.currentTime && element.buffered.end(index) >= element.currentTime) buffered = element.buffered.end(index) - element.currentTime;
      element.playbackRate = livePlaybackRate(hls.latency, hls.targetLatency ?? 0, buffered, element.readyState < 3);
    }, 2000);
    const recovery = setInterval(() => {
      if (!fileMode || !recoverFile || probing || closed) return; probing = true;
      void fetch(absoluteUrl(playback.url), { credentials: 'same-origin', signal: AbortSignal.timeout(5000) }).then(async (response) => {
        if (!response.ok || !(await response.text()).trimStart().startsWith('#EXTM3U') || closed) return;
        const at = element.currentTime; carried = snapshot(); if (restorePosition) { element.removeEventListener('loadedmetadata', restorePosition); restorePosition = undefined; } boot(at);
      }).catch(() => undefined).finally(() => { probing = false; });
    }, 15000);
    return () => { if (frameCallback !== undefined) element.cancelVideoFrameCallback(frameCallback); element.removeEventListener('playing', firstFrame); reporter.destroy(); closed = true; element.removeEventListener('ended', endedLive); element.removeEventListener('error', mediaFailure); window.removeEventListener('offline', wentOffline); window.removeEventListener('online', cameOnline); if (reconnectTimer) clearTimeout(reconnectTimer); clearInterval(alignment); element.playbackRate = 1; clearInterval(recovery); element.removeEventListener('timeupdate', playhead); if (restorePosition) element.removeEventListener('loadedmetadata', restorePosition); policy?.destroy(); destroyStats(); hls?.destroy(); element.pause(); element.removeAttribute('src'); element.load(); };
  }, [playback, enabled]);
  const p2pDisplay = Math.round(stats.p2pPercentage * 10) / 10; const httpDisplay = stats.totalDownloaded > 0 ? 100 - p2pDisplay : 0;
  const active = playback.transport !== 'http' && (enabled || Boolean(playback.delivery)) && !native && typeof RTCPeerConnection !== 'undefined';
  const traffic = (
    <div className={`traffic-overlay ${trafficInside ? 'traffic-inside' : 'traffic-outside'}`} aria-label="Distribuição do tráfego" data-mode={stats.deliveryMode}>
      <span className={stats.deliveryMode === 'p2p' ? 'p2p-active' : ''}>● {active ? stats.deliveryMode === 'p2p' ? 'P2P ativo' : stats.deliveryMode === 'http' ? 'HTTP de contingência · buscando P2P' : playback.transport === 'p2p' ? 'P2P · aguardando seed ou peers' : contingency ? 'Conectando · HTTP disponível' : 'Conectando ao P2P' : 'HTTP'}</span>
      <span>HTTP <b data-testid="http-percentage">{httpDisplay.toFixed(1)}%</b></span><span>P2P <b data-testid="p2p-percentage">{p2pDisplay.toFixed(1)}%</b></span><span>{stats.peers} peers</span><span>↓ {formatBytes(stats.downloadRate)}/s P2P</span><span>↑ {formatBytes(stats.uploadRate)}/s</span><span>Recebido {formatBytes(stats.totalDownloaded)}</span><span>Enviado <b data-testid="upload-bytes">{stats.p2pUploaded < 1024 ? `${(stats.p2pUploaded / 1024).toFixed(1)} KB` : formatBytes(stats.p2pUploaded)}</b></span>
    </div>
  );
  return <><section className="video-shell" aria-label={`Reproduzindo ${title}`}>
    <video ref={video} controls autoPlay playsInline  />
    <div className="video-top"><span className="live-pill">{playback.isLive ? '● AO VIVO' : 'SOB DEMANDA'}</span><span>{title}</span></div>
    {error && <div className="player-message" role="status">{error}</div>}
    {trafficInside && traffic}
  </section>{!trafficInside && traffic}<div className="traffic-settings"><label>Dados de tráfego <select aria-label="Posição dos dados de tráfego" value={trafficInside ? 'inside' : 'outside'} onChange={(event) => { const inside = event.target.value === 'inside'; setTrafficInside(inside); try { localStorage.setItem('hp:traffic-position', inside ? 'inside' : 'outside'); } catch { /* A preferência vale durante esta sessão. */ } }}><option value="outside">Fora do vídeo</option><option value="inside">Dentro do vídeo</option></select></label></div><PlaybackDiagnostics key={playback.url} playback={playback} video={video} source={diagnosticSource} /></>;
}
