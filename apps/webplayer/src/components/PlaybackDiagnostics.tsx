import { useEffect, useState, type RefObject } from 'react';
import type { Playback } from '../api';
import { absoluteUrl } from '../api';
import { telemetryId } from '../p2p/telemetry';
import type { P2PStats } from '../p2p/stats';
export interface DiagnosticSource { stats: P2PStats; latency: number | null; targetLatency: number | null; segment?: { sequence: string; start: number; duration: number; loadMs: number } }
export function PlaybackDiagnostics({ playback, video, source }: { playback: Playback; video: RefObject<HTMLVideoElement | null>; source: RefObject<() => DiagnosticSource> }) {
  const [active, setActive] = useState(false); const [status, setStatus] = useState('');
  useEffect(() => {
    if (!active || !playback.telemetryPath) return;
    const id = telemetryId(); const path = playback.telemetryPath.replace('/telemetry/', '/diagnostics/') + '/' + id;
    let closed = false; let busy = false; let failures = 0; let code = ''; let omitFrames = false; let timer: ReturnType<typeof setInterval> | undefined; let waiting = 0;
    const controller = new AbortController(); const events: { at: number; code: string }[] = [];
    const element = video.current; const beginning = Date.now();
    const note = (event: Event) => { if (event.type === 'waiting') waiting++; events.push({ at: Date.now() - beginning, code: event.type }); if (events.length > 20) events.shift(); };
    const error = (event: Event) => { const code = (event as CustomEvent<{ code?: string }>).detail?.code; if (code && /^[a-zA-Z0-9_-]{1,64}$/.test(code)) { events.push({ at: Date.now() - beginning, code }); if (events.length > 20) events.shift(); } };
    const send = async () => {
      if (closed || busy || !element) return;
      if (Date.now() - beginning >= 600000) { setStatus('Diagnóstico encerrado após 10 minutos.'); setActive(false); return; }
      busy = true;
      try {
        const current = source.current(); const stats = current.stats; const quality = element.getVideoPlaybackQuality?.();
        let frame: string | undefined; let frameStatus: 'captured' | 'no-video' | 'blocked' = 'no-video';
        if (!omitFrames && element.readyState >= 2 && element.videoWidth > 0) {
          try { const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = Math.max(1, Math.round(320 * element.videoHeight / element.videoWidth)); if (canvas.height > 320) canvas.height = 320;
            canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height); const value = canvas.toDataURL('image/jpeg', .45); if (value.length <= 64000) { frame = value; frameStatus = 'captured'; } else frameStatus = 'blocked';
          } catch { frameStatus = 'blocked'; }
        }
        const buffered = Array.from({ length: Math.min(16, element.buffered.length) }, (_, index) => [element.buffered.start(index), element.buffered.end(index)]);
        let response = await fetch(absoluteUrl(path), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          body: JSON.stringify({ time: element.currentTime, ready: element.readyState, paused: element.paused, rate: element.playbackRate, buffered, width: element.videoWidth, height: element.videoHeight, frames: quality?.totalVideoFrames ?? 0, dropped: quality?.droppedVideoFrames ?? 0, peers: stats.peers, http: Math.round(stats.httpDownloaded), p2p: Math.round(stats.p2pDownloaded), upload: Math.round(stats.p2pUploaded), latency: Number.isFinite(current.latency) ? current.latency : null, targetLatency: Number.isFinite(current.targetLatency) ? current.targetLatency : null, waiting, events, segment: current.segment, frame, frameStatus }) });
        if (response.status === 413) {
          omitFrames = true;
          const payload = { time: element.currentTime, ready: element.readyState, paused: element.paused, rate: element.playbackRate, buffered, width: element.videoWidth, height: element.videoHeight, frames: quality?.totalVideoFrames ?? 0, dropped: quality?.droppedVideoFrames ?? 0, peers: stats.peers, http: Math.round(stats.httpDownloaded), p2p: Math.round(stats.p2pDownloaded), upload: Math.round(stats.p2pUploaded), latency: Number.isFinite(current.latency) ? current.latency : null, targetLatency: Number.isFinite(current.targetLatency) ? current.targetLatency : null, waiting, events, segment: current.segment, frameStatus: 'blocked' };
          response = await fetch(absoluteUrl(path), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), body: JSON.stringify(payload) });
        }
        if (!response.ok) {
          if ([401, 403, 410].includes(response.status)) { setStatus(`Diagnóstico encerrado (HTTP ${response.status}). Entre novamente ou ative outra sessão.`); setActive(false); }
          else throw new Error(`HTTP ${response.status}`);
        } else { failures = 0; setStatus(`Diagnóstico recebido às ${new Date().toLocaleTimeString('pt-BR')} · código ${code}${omitFrames ? ' · imagem bloqueada pelo proxy; enviando dados' : ' · dados e imagens'} · limite de 10 minutos`); }
      } catch { if (!closed) { failures++; setStatus(`Envio interrompido · código ${code} · nova tentativa em 5 segundos (${failures}/3)`); if (failures >= 3) { setStatus(`Falha ao enviar diagnóstico · código ${code}. Ative novamente para tentar.`); setActive(false); } } }
      finally { busy = false; }
    };
    const expiry = setTimeout(() => { setStatus('Diagnóstico encerrado após 10 minutos.'); setActive(false); }, 600000);
    const stop = () => { if (closed) return; closed = true; clearTimeout(expiry); controller.abort(); if (timer) clearInterval(timer); void fetch(absoluteUrl(path), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined); };
    const hide = () => { stop(); setActive(false); setStatus('Compartilhamento encerrado ao sair da aba.'); };
    window.addEventListener('pagehide', hide); window.addEventListener('highpass:playback-error', error);
    for (const type of ['waiting', 'stalled', 'playing', 'seeking', 'seeked', 'pause', 'error']) element?.addEventListener(type, note);
    void fetch(absoluteUrl(path + '/start'), { method: 'POST', credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) }).then(async (response) => {
      if (!response.ok) throw new Error('start-failed'); const value = await response.json() as { code: string }; if (closed) return;
      code = value.code; setStatus(`Compartilhando diagnóstico e imagens · código ${code} · aguardando primeiro recebimento`); void send(); timer = setInterval(() => { void send(); }, 5000);
    }).catch(() => { if (!closed) { setStatus('Não foi possível iniciar o diagnóstico.'); setActive(false); } });
    return () => { stop(); window.removeEventListener('pagehide', hide); window.removeEventListener('highpass:playback-error', error); for (const type of ['waiting', 'stalled', 'playing', 'seeking', 'seeked', 'pause', 'error']) element?.removeEventListener(type, note); };
  }, [active, playback, video, source]);
  return <div className="diagnostic-controls"><button onClick={() => { setStatus(''); setActive(!active); }}>{active ? 'Parar compartilhamento' : 'Compartilhar diagnóstico e imagens'}</button><span role="status">{active ? status || 'Iniciando diagnóstico…' : status || 'Ao ativar, envia dados de reprodução e uma imagem do vídeo a cada 5 segundos ao administrador. Apenas a última amostra é mantida e expira em 60 segundos.'}</span></div>;
}
