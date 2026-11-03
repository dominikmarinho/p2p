import { clientLabel } from './transport';
import { useState } from 'react';
import { api, type Account } from './api';

export function Login({ onLogin }: { onLogin: (account: Account) => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api<{ account: Account }>('login', { method: 'POST', body: JSON.stringify({ username, password }) }); setPassword(''); onLogin(result.account); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível entrar'); }
    finally { setBusy(false); }
  }
  return <main className="login-screen"><div className="login-story"><a className="wordmark" href="/player/">H<span>HIGH PASS<small>PLAY · {clientLabel}</small></span></a><p className="eyebrow">A SUA PROGRAMAÇÃO. NO SEU TEMPO.</p><h1>O melhor da sua TV.<br /><em>Em toda tela.</em></h1><p>Canais ao vivo, filmes e séries em um só lugar.<br />Uma experiência conectada, do sofá ao celular.</p><div className="login-tags"><span>AO VIVO</span><span>FILMES & SÉRIES</span><span>WEB + ANDROID TV</span></div></div><form className="login-card" onSubmit={(event) => { void login(event); }}><span className="section-label">BEM-VINDO AO HIGH PASS</span><h2>É só dar o play.</h2><p>Entre com os dados da sua assinatura.</p><label>Usuário<input name="username" autoComplete="username" autoFocus required maxLength={128} value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary" disabled={busy}>{busy ? 'Conectando…' : 'Entrar e assistir →'}</button>{error && <p className="error" role="alert">{error}</p>}<small>Seus dados são validados diretamente na sua operadora.</small></form></main>;
}
