import { useEffect, useRef, useState } from 'react';
import { api, type Account, type CatalogItem, type ContentKind, type EpgItem, type Episode, type Playback } from './api';
import { ClientUpdates } from './components/ClientUpdates';
import { Login } from './Login';
import { P2PVideoPlayer } from './components/P2PVideoPlayer';

const sections = [{ id: 'live', label: 'Canais ao vivo', icon: '◉' }, { id: 'movie', label: 'Filmes', icon: '▣' }, { id: 'series', label: 'Séries', icon: '▤' }, { id: 'favorites', label: 'Favoritos', icon: '♡' }, { id: 'settings', label: 'Configurações', icon: '⚙' }, { id: 'account', label: 'Minha conta', icon: '◌' }];
type View = ContentKind | 'favorites' | 'settings' | 'account';
function savedFavorites(accountId: string): CatalogItem[] { try { return JSON.parse(localStorage.getItem(`hp:favorites:${accountId}`) ?? '[]') as CatalogItem[]; } catch { return []; } }

export function App() {
  const selection = useRef(0);
  const [account, setAccount] = useState<Account | null>(null); const [checking, setChecking] = useState(true); const [view, setView] = useState<View>('live');
  const [items, setItems] = useState<CatalogItem[]>([]); const [total, setTotal] = useState(0); const [offset, setOffset] = useState(0); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]); const [category, setCategory] = useState(''); const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CatalogItem | null>(null); const [playback, setPlayback] = useState<Playback | null>(null); const [epg, setEpg] = useState<EpgItem[]>([]); const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [favorites, setFavorites] = useState<CatalogItem[]>([]); const [p2p, setP2p] = useState(localStorage.getItem('hp:p2p') !== 'false');
  useEffect(() => { void api<Account>('account').then(setAccount).catch(() => undefined).finally(() => setChecking(false)); }, []);
  useEffect(() => { if (account) setFavorites(savedFavorites(account.accountId)); }, [account]);
  const kind: ContentKind = view === 'movie' || view === 'series' ? view : 'live';
  useEffect(() => {
    if (!account || !['live', 'movie', 'series'].includes(view)) return;
    let cancelled = false;
    void api<{ id: string; name: string }[]>(`categories?kind=${kind}`).then((data) => { if (!cancelled) setCategories(data); }).catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [view, kind, account]);
  useEffect(() => {
    if (!account || !['live', 'movie', 'series'].includes(view)) return;
    let cancelled = false; setLoading(true); setError('');
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ kind, offset: String(offset), limit: '100' }); if (category) query.set('category', category); if (search) query.set('search', search);
      void api<{ items: CatalogItem[]; total: number }>(`catalog?${query.toString()}`).then((result) => { if (!cancelled) { setItems(result.items); setTotal(result.total); } }).catch((failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Catálogo indisponível'); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [account, view, kind, offset, category, search]);
  async function choose(item: CatalogItem) {
    const request = ++selection.current;
    setSelected(item); setError(''); setPlayback(null); setEpisodes([]); setEpg([]);
    try {
      if (item.kind === 'series') { const result = await api<Episode[]>(`series/${item.id}`); if (selection.current === request) setEpisodes(result); }
      else {
        const result = await api<Playback>('playback', { method: 'POST', body: JSON.stringify({ kind: item.kind, id: item.id }) });
        if (selection.current !== request) return;
        setPlayback(result);
        if (item.kind === 'live') void api<EpgItem[]>(`epg/${item.id}`).then((data) => { if (selection.current === request) setEpg(data); }).catch(() => { if (selection.current === request) setEpg([]); });
      }
    } catch (failure) { if (selection.current === request) setError(failure instanceof Error ? failure.message : 'Conteúdo indisponível'); }
  }
  async function playEpisode(episode: Episode, seriesId: string) {
    const request = ++selection.current; setError(''); setPlayback(null);
    try { const result = await api<Playback>('playback', { method: 'POST', body: JSON.stringify({ kind: 'episode', id: episode.id, seriesId }) }); if (selection.current === request) setPlayback(result); }
    catch (failure) { if (selection.current === request) setError(failure instanceof Error ? failure.message : 'Episódio indisponível'); }
  }
  function favorite(item: CatalogItem) {
    if (!account) return;
    const exists = favorites.some((entry) => entry.id === item.id && entry.kind === item.kind);
    const updated = exists ? favorites.filter((entry) => entry.id !== item.id || entry.kind !== item.kind) : [...favorites, item].slice(-500);
    setFavorites(updated); localStorage.setItem(`hp:favorites:${account.accountId}`, JSON.stringify(updated));
  }
  function navigate(next: View) { if (next === view) return; ++selection.current; setItems([]); setTotal(0); setCategories([]); setSelected(null); setPlayback(null); setEpisodes([]); setEpg([]); setView(next); setCategory(''); setSearch(''); setOffset(0); setError(''); }
  async function logout() { ++selection.current; try { await api('logout', { method: 'POST' }); } finally { setAccount(null); setPlayback(null); setSelected(null); } }
  if (checking) return <div className="splash">HIGH PASS <span>Conectando sua programação…</span></div>;
  if (!account) return <Login onLogin={setAccount} />;
  const list = view === 'favorites' ? favorites.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) : items;
  const heading = sections.find((section) => section.id === view)?.label;
  return <div className="app-layout"><aside className="sidebar"><a className="wordmark" href="/player/">H<span>HIGH PASS<small>PLAY · P2P NETWORK</small></span></a><span className="section-label">SEU ENTRETENIMENTO</span><nav>{sections.map((section) => <button key={section.id} className={view === section.id ? 'active' : ''} onClick={() => navigate(section.id as View)}><span>{section.icon}</span>{section.label}</button>)}</nav><div className="sidebar-bottom"><span className="connection-dot">● Engine conectada</span><small>{account.username}</small><button onClick={() => { void logout(); }}>Sair da conta ↗</button></div></aside>
    <main className="main-content"><header className="topbar"><div><p className="eyebrow">HIGH PASS / SUA BIBLIOTECA</p><h1>{heading}</h1></div><div className="profile-avatar">{account.username.slice(0, 1).toUpperCase()}</div></header>
      {error && <p className="error" role="alert">{error}</p>}
      {view === 'account' ? <section className="surface account"><span className="section-label">SUA ASSINATURA</span><h2>Olá, {account.username}.</h2><p>Sessão válida até {new Date(account.expiresAt).toLocaleString('pt-BR')}.</p><p>Conexões da linha: {account.maxConnections}</p><p>Os canais e conteúdos disponíveis são definidos pela sua operadora.</p><button className="primary" onClick={() => { void logout(); }}>Encerrar sessão</button></section>
        : view === 'settings' ? <section className="surface"><span className="section-label">DO SEU JEITO</span><h2>Qualidade de conexão</h2><ClientUpdates />{account.p2pRequired ? <p>P2P automático para canais, filmes e séries, com HTTP de contingência e retorno automático após recuperação.</p> : <label className="toggle"><input type="checkbox" checked={p2p} onChange={(event) => { setP2p(event.target.checked); localStorage.setItem('hp:p2p', String(event.target.checked)); }} /> Compartilhar segmentos P2P nos canais ao vivo</label>}<p>O player continua usando HTTP quando não há peers. Em redes que bloqueiam conexão direta, o operador pode configurar TURN.</p><p>Favoritos ficam salvos neste navegador. Senhas e tokens de sessão não ficam no armazenamento local.</p></section>
          : <><div className="browse-toolbar"><label className="search-label"><span>⌕</span><input aria-label="Buscar conteúdo" placeholder="Encontre seu próximo play" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></label>{view !== 'favorites' && <select aria-label="Categoria" value={category} onChange={(event) => { setCategory(event.target.value); setOffset(0); }}><option value="">Todas as categorias</option>{categories.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select>}<span className="content-count">{view === 'favorites' ? list.length : total} títulos</span></div>
            {view === 'live' ? <div className="live-layout"><section className="channel-panel"><div className="panel-heading">NA SUA TELA <span>{loading ? 'Atualizando…' : 'AO VIVO'}</span></div>{list.map((item) => <button className={`channel ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => { void choose(item); }}><span className="channel-mark">{item.name.slice(0, 2).toUpperCase()}</span><span>{item.name}<small>Transmissão ao vivo</small></span><span className="channel-dot">●</span></button>)}{!loading && !list.length && <p className="empty">Nenhum canal nesta seleção.</p>}</section><div className="watch-area">{playback && selected ? <P2PVideoPlayer playback={playback} title={selected.name} enabled={p2p} /> : <div className="player-empty"><span className="play-symbol">▷</span><h2>O seu ao vivo começa aqui.</h2><p>Escolha um canal ao lado para assistir.</p><small>CONEXÃO DIRETA + REDE P2P</small></div>}<div className="watch-heading"><div><span className="section-label">AGORA NA SUA TELA</span><h2>{selected?.name ?? 'Sua programação favorita'}</h2></div>{selected && <button aria-label="Alternar favorito" onClick={() => favorite(selected)}>{favorites.some((item) => item.id === selected.id && item.kind === selected.kind) ? '♥ Favorito' : '♡ Favoritar'}</button>}</div><section className="epg"><h3>Guia de programação</h3>{epg.length ? epg.map((entry, index) => <article key={`${entry.start}:${index}`}><span>{entry.start.slice(-8, -3)} — {entry.end.slice(-8, -3)}</span><div><strong>{entry.title}</strong><p>{entry.description}</p></div></article>) : <p className="muted">Selecione um canal. O guia será exibido quando disponibilizado pela operadora.</p>}</section></div></div>
              : <><div className="poster-grid">{list.map((item) => <article key={`${item.kind}:${item.id}`} className="poster-card"><button onClick={() => { void choose(item); }}><div className="poster-art">{item.image ? <img src={item.image.startsWith('https://') ? item.image : `/api/iptv/artwork/${item.kind}/${item.id}`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}<span>{item.name.slice(0, 1)}</span><em>▶</em></div><h3>{item.name}</h3><small>{item.kind === 'series' ? 'Série' : item.kind === 'movie' ? 'Filme' : 'Ao vivo'}</small></button><button className="favorite-button" aria-label={`Favoritar ${item.name}`} onClick={() => favorite(item)}>{favorites.some((entry) => entry.id === item.id && entry.kind === item.kind) ? '♥' : '♡'}</button></article>)}</div>{!list.length && !loading && <p className="empty">Nenhum título nesta seleção.</p>}{selected && <section className="surface selected-content"><div className="watch-heading"><h2>{selected.name}</h2><button onClick={() => { ++selection.current; setSelected(null); setPlayback(null); }}>Fechar ×</button></div>{episodes.length > 0 && <div className="episode-list">{episodes.map((episode) => <button key={episode.id} onClick={() => { void playEpisode(episode, selected.id); }}>T{episode.season} · {episode.name} ▶</button>)}</div>}{playback && <P2PVideoPlayer playback={playback} title={selected.name} enabled={p2p} />}</section>}</>}
            {view !== 'favorites' && total > 100 && <div className="pagination"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>← Anterior</button><span>{offset + 1}–{Math.min(offset + 100, total)} de {total}</span><button disabled={offset + 100 >= total} onClick={() => setOffset(offset + 100)}>Próxima →</button></div>}</>}
    </main></div>;
}
