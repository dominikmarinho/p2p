import { useEffect, useState } from 'react';
import { telemetryId } from '../p2p/telemetry';
import { armStartupProbe, startupSnapshot } from '../p2p/startup-probe';

/** Explicit opt-in before the channel click; metadata only, no image recording. */
export function StartupDiagnostics() {
  const [active, setActive] = useState(false); const [status, setStatus] = useState(''); const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) return;
    const path = '/api/iptv/diagnostics/startup/' + telemetryId(); const controller = new AbortController();
    let closed = false; let busy = false; let code = ''; let timer: ReturnType<typeof setInterval> | undefined; const beginning = Date.now();
    const stop = () => { if (closed) return; closed = true; armStartupProbe(false); setReady(false); controller.abort(); if (timer) clearInterval(timer); void fetch(path, { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined); };
    const send = async () => {
      if (closed || busy) return;
      if (Date.now() - beginning >= 600000) { setStatus('Análise encerrada após 10 minutos.'); setActive(false); return; }
      busy = true;
      try {
        const startup = startupSnapshot(); const video = document.querySelector('video'); const quality = video?.getVideoPlaybackQuality?.();
        const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), body: JSON.stringify({ startup, time: video?.currentTime ?? 0, ready: video?.readyState ?? 0, paused: video?.paused ?? true, rate: video?.playbackRate ?? 1, buffered: video ? Array.from({ length: Math.min(16, video.buffered.length) }, (_, index) => [video.buffered.start(index), video.buffered.end(index)]) : [], width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0, frames: quality?.totalVideoFrames ?? 0, dropped: quality?.droppedVideoFrames ?? 0, peers: 0, http: 0, p2p: 0, upload: 0, latency: null, targetLatency: null, waiting: 0, events: [], frameStatus: 'disabled' }) });
        if (closed) return;
        if ([401, 403, 410].includes(response.status)) { setStatus('Análise expirada. Entre novamente ou ative outra sessão.'); setActive(false); }
        else if (!response.ok) setStatus(`Falha temporária no envio (HTTP ${response.status}) · código ${code} · tentando novamente`);
        else setStatus(`Código ${code} · ${startup ? startup.marks.firstFrame !== undefined ? `clique → primeiro frame: ${(startup.marks.firstFrame / 1000).toFixed(2)} s` : `aguardando vídeo: ${(startup.elapsedMs / 1000).toFixed(1)} s desde o clique` : 'pronto: clique em um canal'} · diagnóstico recebido`);
      } catch { if (!closed) setStatus(`Conexão interrompida · código ${code} · tentando novamente`); }
      finally { busy = false; }
    };
    const hide = () => { stop(); setActive(false); setStatus('Análise encerrada ao sair da página.'); };
    const expiry = setTimeout(() => { setStatus('Análise encerrada após 10 minutos.'); setActive(false); }, 600000);
    window.addEventListener('pagehide', hide);
    void fetch(path + '/start', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) }).then(async (response) => {
      if (!response.ok) throw new Error('activation'); const value = await response.json() as { code: string }; if (closed) return;
      code = value.code; armStartupProbe(true); setReady(true); await send(); if (!closed) timer = setInterval(() => { void send(); }, 5000);
    }).catch(() => { if (!closed) { setStatus('Não foi possível iniciar a análise. Tente novamente.'); setActive(false); } });
    return () => { clearTimeout(expiry); window.removeEventListener('pagehide', hide); stop(); };
  }, [active]);
  return <section className="diagnostic-controls" aria-label="Diagnóstico de abertura"><button onClick={() => { setStatus(''); setActive(!active); }}>{active ? 'Parar análise de abertura' : 'Compartilhar diagnóstico de abertura'}</button><span role="status">{status || (active ? 'Preparando análise… aguarde antes de clicar no canal.' : 'Ative antes de escolher um canal para medir o clique até o primeiro frame. Envia tempos e buffer por até 10 minutos, sem imagens.')}</span>{ready && <small>Análise pronta antes do clique</small>}</section>;
}
