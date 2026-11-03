import { useEffect, useState } from 'react';

const buildEnvironment = import.meta.env as { VITE_CLIENT_VERSION?: string; VITE_CLIENT_BUILD?: string };
const installedVersion = buildEnvironment.VITE_CLIENT_VERSION || '1.1.0';
const installedBuild = buildEnvironment.VITE_CLIENT_BUILD || 'development';
export function ClientUpdates() {
  const [state, setState] = useState<'idle' | 'checking' | 'current' | 'available' | 'error'>('idle');
  const platform = new URLSearchParams(window.location.search).get('tv');
  async function check() {
    setState('checking');
    try { const response = await fetch('/player/version.json', { cache: 'no-store', signal: AbortSignal.timeout(6000) }); if (!response.ok) throw new Error('unavailable'); const latest = await response.json() as { version: string; build: string }; if (typeof latest.version !== 'string' || typeof latest.build !== 'string') throw new Error('invalid'); setState(latest.build !== installedBuild || latest.version !== installedVersion ? 'available' : 'current'); }
    catch { setState('error'); }
  }
  useEffect(() => { void check(); }, []);
  return <section className="client-updates" aria-label="Atualizações do aplicativo">
    <div><span className="section-label">SEMPRE EM DIA</span><h3>Atualizações do aplicativo</h3><p>Versão {installedVersion}{platform ? ` · ${platform === 'tizen' ? 'Samsung Tizen' : 'LG webOS'}` : ' · WebPlayer'}</p></div>
    <p role="status">{state === 'checking' ? 'Verificando atualizações…' : state === 'available' ? 'Uma nova atualização está disponível.' : state === 'current' ? 'Sua interface está atualizada.' : state === 'error' ? 'Não foi possível verificar. Tente novamente.' : 'Consulte a versão mais recente.'}</p>
    <div className="update-actions"><button onClick={() => { void check(); }} disabled={state === 'checking'}>Verificar atualizações</button>{state === 'available' && <button className="primary" onClick={() => { if (window.confirm('Atualizar a interface? A reprodução será reiniciada. Seu login e favoritos serão mantidos.')) window.location.reload(); }}>Atualizar interface agora</button>}
      {!platform && <a className="download-app" href="/downloads/android/highpass-latest.apk" download>Baixar aplicativo Android</a>}</div>
    {platform && <p className="muted">Esta opção atualiza a interface hospedada. Atualizações do pacote instalado são feitas pelo mecanismo da sua TV.</p>}
  </section>;
}
