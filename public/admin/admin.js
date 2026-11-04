const $ = (id) => document.getElementById(id);
let mustChangePassword = false;
let view = 'overview';
let editing = null;
let renderVersion = 0;
let committedView = null;
const titles = { monitoring: 'Monitoramento e diagnóstico', seeds: 'Seeds de mídia', overview: 'Visão geral', 'xui-servers': 'Servidores XUI ONE', routes: 'Roteamento de canais', config: 'Parâmetros P2P', keys: 'Chaves do Control Plane', whitelist: 'Whitelist de IPs', audit: 'Auditoria', profile: 'Meu perfil' };
const definitions = {
  'xui-servers': [['name', 'Nome', 'text'], ['baseUrl', 'URL base autorizada', 'url'], ['adminAccessCode', 'Access Code do XUI (tipo Admin API)', 'password'], ['adminApiKey', 'API Key do administrador XUI', 'password'], ['enabled', 'Habilitado', 'checkbox']],
  routes: [['channel', 'Identificador do canal', 'text'], ['streamId', 'ID do stream XUI', 'number'], ['serverId', 'UUID do servidor principal', 'text'], ['fallbackServerIds', 'UUIDs de fallback, separados por vírgulas', 'text'], ['enabled', 'Habilitado', 'checkbox']],
  config: [['bufferSeconds', 'Buffer em segundos', 'number'], ['maxUploadKbps', 'Upload por peer em Kbps (informado ao cliente)', 'number'], ['maxConnectionsPerNode', 'Conexões por linha', 'number'], ['maxPeersPerChannel', 'Peers por canal', 'number']],
  keys: [['name', 'Nome da automação P2P', 'text']], whitelist: [['cidr', 'IP ou CIDR', 'text']],
};
const columns = { 'xui-servers': ['name', 'baseUrl', 'enabled', 'hasAdminAccessCode', 'hasAdminApiKey', 'id'], routes: ['channel', 'streamId', 'serverId', 'enabled'], keys: ['name', 'id', 'createdAt'], whitelist: ['cidr', 'id'], audit: ['createdAt', 'actor', 'action', 'resource', 'ip'] };
const labels = { name: 'Nome', baseUrl: 'URL base', enabled: 'Habilitado', hasAdminAccessCode: 'Access Code configurado', hasAdminApiKey: 'API Key XUI configurada', id: 'ID', createdAt: 'Criado em' };
const secretFields = new Set(['adminAccessCode', 'adminApiKey']);
async function api(path, options = {}) {
  const response = await fetch('/api/admin/' + path, { ...options, headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) } });
  if (response.status === 204) return null;
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || 'Operação recusada');
  return value;
}
function element(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
async function render() {
  const currentView = view; const version = ++renderVersion;
  const current = () => currentView === view && version === renderVersion;
  const content = element('div');
  const commit = () => { if (current()) { $('content').replaceChildren(...content.childNodes); $('content').inert = false; committedView = currentView; } };
  $('content').inert = true;
  $('title').textContent = titles[currentView]; $('notice').textContent = '';
  document.querySelectorAll('nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));
  try {
    if (currentView === 'profile') {
      const panel = element('form', undefined, 'panel'); panel.append(element('h2', 'Alterar senha'), element('p', mustChangePassword ? 'Defina uma senha própria para liberar a operação.' : 'A alteração encerra suas outras sessões.'));
      for (const [name, label] of [['currentPassword', 'Senha atual'], ['newPassword', 'Nova senha (12 caracteres ou mais)']]) { const field = element('label', label); const input = element('input'); input.type = 'password'; input.name = name; input.required = true; input.maxLength = 256; input.minLength = name === 'newPassword' ? 12 : 1; input.autocomplete = name === 'newPassword' ? 'new-password' : 'current-password'; field.append(input); panel.append(field); }
      const save = element('button', 'Salvar nova senha', 'primary'); panel.append(save);
      panel.onsubmit = async (event) => { event.preventDefault(); try { await api('change-password', { method: 'PUT', body: JSON.stringify({ currentPassword: panel.elements.currentPassword.value, newPassword: panel.elements.newPassword.value }) }); mustChangePassword = false; view = 'overview'; await render(); $('notice').textContent = 'Senha alterada.'; } catch (error) { $('notice').textContent = error.message; } };
      content.append(panel); commit(); return;
    }
    if (currentView === 'overview') {
      const [servers, routes, events, peers] = await Promise.all(['xui-servers', 'routes', 'audit', 'peers'].map((path) => api(path))); if (!current()) return;
      const cards = element('div', undefined, 'cards');
      for (const [label, value] of [['Servidores cadastrados', servers.length], ['Canais roteados', routes.length], ['WebSockets ativos', peers.connections], ['Eventos recentes', events.length]]) { const card = element('div', undefined, 'card'); const counter = element('strong', String(value)); if (label === 'WebSockets ativos') counter.id = 'active-peers'; card.append(element('p', label), counter); cards.append(card); }
      const panel = element('div', undefined, 'panel'); panel.append(element('h2', 'Uma origem. Uma rede de peers.'), element('p', 'Cadastre uma origem XUI ONE autorizada, associe seus canais e ajuste os limites da engine. Cada linha é validada na origem antes de receber um ticket de sinalização.'), element('p', 'Prometheus coleta a API e os processos Node.js. O dashboard provisionado do Grafana reúne CPU, memória, HTTP e conexões WebSocket.'));
      content.append(cards, panel); commit(); return;
    }
    if (currentView === 'monitoring') {
      const data = await api('monitoring'); if (!current()) return; const cards = element('div', undefined, 'cards');
      for (const [label, value] of [['Memória do processo', `${(data.memory.rss / 1048576).toFixed(0)} MB`], ['Redis · ping', `${data.redisPingMs.toFixed(1)} ms`], ['PostgreSQL · esperando conexão', data.database.waiting], ['Seeds prontos / alocados', `${data.seeds.ready} / ${data.seeds.active}`]]) { const card = element('div', undefined, 'card'); card.append(element('p', label), element('strong', String(value))); cards.append(card); }
      const panel = element('div', undefined, 'panel'); panel.append(element('h2', 'Diagnóstico de reprodução e infraestrutura'), element('p', `${data.upstream.pendingMetadata} consulta(s) aguardando a origem. Processo ativo há ${(data.uptime / 3600).toFixed(1)} h; pool PostgreSQL ${data.database.total} conexões, ${data.database.idle} livres.`));
      if (data.upstream.media) {
        const media = data.upstream.media;
        panel.append(element('h3', 'Sessões HLS e cache da origem'), element('p', `Aberturas da URL inicial: ${media.playlistOpens} · recargas da sessão reutilizada: ${media.playlistReloads} · buscas de mídia: ${media.mediaRequests}.`), element('p', `${media.sessions} contexto(s) HLS em cache · ${media.pending} busca(s) em andamento · ${(media.cachedBytes / 1048576).toFixed(1)} MB em cache · ${media.cacheHits} acerto(s) de cache · ${media.coalesced} pedido(s) concorrente(s) compartilhado(s).`), element('p', 'Uma sessão HLS transfere playlists e segmentos durante a reprodução. Aberturas iniciais crescentes para o mesmo canal indicam reconexão; a contagem de sessões ativas no XUI deve ser conferida no próprio XUI.'));
      }
      const link = element('a', 'Abrir Grafana · seeds, latência da origem, sondas HTTPS, host e containers'); link.href = '/grafana/d/fastify-p2p-dashboard'; link.target = '_blank'; link.rel = 'noopener'; panel.append(link, element('p', 'A latência da API inclui consultas ao XUI. O dashboard separa o tempo até os headers da origem e os endpoints locais. Os contadores do seed medem payload real do worker; não representam tráfego total entre todos os aparelhos.'));
      panel.append(element('h3', 'Falhas recentes da origem nesta instância'));
      if (!data.upstream.recentFailures.length) panel.append(element('p', 'Nenhuma falha registrada desde a inicialização.'));
      for (const failure of [...data.upstream.recentFailures].reverse()) panel.append(element('p', `${failure.at} · ${failure.kind} · ${failure.code}`));
      panel.append(element('h3', 'Telemetria reportada pelos players'), element('p', `${data.players.modes.p2p} recebendo P2P · ${data.players.modes.http} recebendo HTTP · ${data.players.modes.waiting} aguardando dados. Janela de 30 segundos.`), element('p', `Recebido HTTP: ${(Number(data.players.bytes.http || 0) / 1048576).toFixed(1)} MB · recebido P2P: ${(Number(data.players.bytes.p2p || 0) / 1048576).toFixed(1)} MB. Totais declarados pelos clientes; não usar para cobrança.`));
      for (const failure of data.players.failures) panel.append(element('p', `${failure.at} · ${failure.client} · ${failure.code}`));
      content.append(cards, panel); commit(); return;
    }
    if (currentView === 'seeds') {
      const state = await api('seeds'); if (!current()) return;
      if (!state || !Array.isArray(state.streams)) throw new Error('Resposta de seeds incompatível. Recarregue o painel para tentar novamente.'); const panel = element('div', undefined, 'panel');
      panel.append(element('h2', state.enabled ? 'Distribuição P2P com seed automático' : 'Instância de HTTP de contingência'), element('p', 'Cada conteúdo ativo compartilha um seed. A origem alimenta o seed por HTTP; os players recebem os segmentos por WebRTC quando disponíveis e usam HTTP durante falhas de entrega.'), element('p', `${state.active} conteúdo(s) alocado(s) · ${state.ready} seed(s) pronto(s). Dados desta instância.`));
      content.append(panel);
      if (!state.streams.length) { content.append(element('div', 'Nenhuma reprodução P2P ativa nesta instância.', 'empty')); commit(); return; }
      const wrap = element('div', undefined, 'table-wrap'); const table = element('table'); const header = element('tr');
      for (const title of ['Tipo', 'Conteúdo XUI', 'Players', 'Workers prontos', 'Estado', 'HTTP recebido pelo seed', 'Enviado por P2P', 'Ações']) header.append(element('th', title)); table.append(header);
      for (const seed of state.streams) {
        const row = element('tr'); for (const value of [seed.kind, seed.content, seed.viewers, `${seed.readyWorkers ?? 0}/${seed.workerCount ?? 0}`, seed.ready ? 'Pronto' : 'Preparando / recuperando', `${(seed.originBytes / 1048576).toFixed(1)} MB`, `${(seed.p2pUploaded / 1048576).toFixed(1)} MB`]) row.append(element('td', String(value)));
        const actions = element('td'); const restart = element('button', 'Reiniciar seed'); restart.onclick = async () => { if (!confirm('Reiniciar o alimentador da origem? Os workers de réplica continuarão servindo os segmentos já recebidos. Clientes somente P2P não usarão HTTP.')) return; try { await api(`seeds/${seed.swarm}/restart`, { method: 'POST' }); await render(); } catch (error) { $('notice').textContent = error.message; } }; actions.append(restart); row.append(actions); table.append(row);
      }
      wrap.append(table); content.append(wrap); commit(); return;
    }
    const rows = await api(currentView); if (!current()) return;
    if (currentView === 'xui-servers') {
      const help = element('div', undefined, 'panel');
      help.append(element('h2', 'Credenciais administrativas do XUI ONE'), element('p', 'Cadastre o Access Code do tipo Admin API e a API Key gerada no perfil do administrador do XUI. Salve e use Testar Admin API para validar a conexão.'), element('p', 'A URL base contém o domínio e a porta da origem. Cole somente o código no campo Access Code. Essas credenciais são usadas pelo servidor; o player continua usando usuário e senha da linha.'));
      if (rows.some((row) => row.hasLegacyApiToken)) help.append(element('p', 'Há uma credencial do cadastro anterior para revisar. Preencha os dois campos corretos e remova a credencial anterior após conferir.'));
      content.append(help);
    }
    if (currentView === 'keys') {
      const help = element('div', undefined, 'panel');
      help.append(element('h2', 'Acesso de automações à API do P2P'), element('p', 'As chaves geradas aqui autorizam integrações com o Control Plane. A API Key do XUI ONE deve ser cadastrada em Servidores XUI ONE.'));
      content.append(help);
    }
    if (currentView === 'config') {
      const panel = element('div', undefined, 'panel');
      for (const [name, label] of definitions.config) panel.append(element('p', `${label}: ${rows[name]}`));
      const edit = element('button', 'Editar parâmetros', 'primary'); edit.onclick = () => openEditor(rows); panel.append(edit); content.append(panel); commit(); return;
    }
    if (!Array.isArray(rows) || !Array.isArray(columns[currentView])) throw new Error('Resposta administrativa incompatível. Recarregue o painel para tentar novamente.');
    const toolbar = element('div', undefined, 'toolbar'); toolbar.append(element('span', `${rows.length} registros`));
    if (currentView !== 'audit') { const button = element('button', '+ Adicionar', 'primary'); button.onclick = () => openEditor(null); toolbar.append(button); }
    content.append(toolbar);
    if (!rows.length) { content.append(element('div', 'Nenhum registro. Adicione a primeira configuração.', 'empty')); commit(); return; }
    const wrap = element('div', undefined, 'table-wrap'); const table = element('table'); const header = element('tr');
    columns[currentView].forEach((name) => header.append(element('th', labels[name] ?? name))); if (currentView !== 'audit') header.append(element('th', 'Ações')); table.append(header);
    rows.forEach((row) => {
      const tr = element('tr'); columns[currentView].forEach((name) => tr.append(element('td', typeof row[name] === 'boolean' ? (row[name] ? 'Sim' : 'Não') : String(row[name] ?? ''))));
      if (currentView !== 'audit') {
        const actions = element('td');
        if (definitions[currentView]) { const edit = element('button', 'Editar'); edit.onclick = () => openEditor(row); actions.append(edit); }
        if (currentView === 'xui-servers') {
          const test = element('button', 'Testar Admin API');
          test.onclick = async () => { $('notice').textContent = ''; test.disabled = true; test.textContent = 'Testando…'; try { const result = await api(`xui-servers/${row.id}/test`, { method: 'POST' }); $('notice').textContent = `Admin API autenticada: ${result.serverCount} servidor(es) retornado(s).`; } catch (error) { $('notice').textContent = error.message; } finally { test.disabled = false; test.textContent = 'Testar Admin API'; } }; actions.append(test);
          if (row.hasAdminAccessCode || row.hasAdminApiKey || row.hasLegacyApiToken) {
            const clear = element('button', 'Remover credenciais Admin API');
            clear.onclick = async () => { if (!confirm('Remover as credenciais administrativas deste servidor XUI?')) return; try { await api(`xui-servers/${row.id}`, { method: 'PUT', body: JSON.stringify({ name: row.name, baseUrl: row.baseUrl, enabled: row.enabled, adminAccessCode: '', adminApiKey: '' }) }); await render(); } catch (error) { $('notice').textContent = error.message; } }; actions.append(clear);
          }
        }
        const remove = element('button', 'Excluir'); remove.onclick = async () => { if (!confirm('Excluir este registro?')) return; try { await api(`${currentView}/${encodeURIComponent(row.id ?? row.channel)}`, { method: 'DELETE' }); await render(); } catch (error) { $('notice').textContent = error.message; } }; actions.append(remove); tr.append(actions);
      }
      table.append(tr);
    }); wrap.append(table); content.append(wrap); commit();
  } catch (error) { if (current()) { $('notice').textContent = error.message; if (committedView !== currentView) $('content').replaceChildren(element('div', 'Não foi possível carregar esta página. Tente novamente pelo menu.', 'empty')); $('content').inert = false; } }
}
function openEditor(row) {
  editing = row; $('fields').replaceChildren(); $('edit-error').textContent = ''; $('edit-title').textContent = (row ? 'Editar · ' : 'Adicionar · ') + titles[view];
  if (view === 'xui-servers') $('fields').append(element('p', 'Deixe os campos de credenciais em branco para manter os valores já salvos. A API Key é gerada no perfil do administrador no XUI ONE.'));
  definitions[view].forEach(([name, label, type]) => {
    const field = element('label', label); const input = element('input'); input.name = name; input.type = type;
    if (type === 'checkbox') input.checked = row ? Boolean(row[name]) : true;
    else { input.value = Array.isArray(row?.[name]) ? row[name].join(', ') : (row?.[name] ?? ''); input.required = !secretFields.has(name) && name !== 'fallbackServerIds'; }
    if (type === 'number') { input.min = '1'; input.step = '1'; }
    if (type === 'password') { input.autocomplete = 'new-password'; input.value = ''; input.placeholder = row ? 'Vazio mantém o valor atual' : 'Necessário para testar a Admin API'; }
    if (name === 'channel' && row) input.readOnly = true;
    field.append(input); $('fields').append(field);
  }); $('editor').showModal();
}
$('edit-form').onsubmit = async (event) => {
  event.preventDefault(); const body = {};
  for (const [name, , type] of definitions[view]) {
    const input = $('edit-form').elements.namedItem(name);
    if (secretFields.has(name) && !input.value.trim()) continue;
    body[name] = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : name === 'fallbackServerIds' ? input.value.split(',').map((part) => part.trim()).filter(Boolean) : input.value;
  }
  try {
    const path = view + (['xui-servers', 'keys', 'whitelist'].includes(view) && editing ? '/' + editing.id : '');
    const result = await api(path, { method: ['config', 'routes'].includes(view) || editing ? 'PUT' : 'POST', body: JSON.stringify(body) });
    $('editor').close(); if (view === 'config') view = 'overview'; await render();
    if (result?.secret) { const panel = element('div', undefined, 'panel'); panel.append(element('p', 'Copie a chave agora. Ela não será exibida novamente.'), element('pre', result.secret, 'secret')); $('content').prepend(panel); }
  } catch (error) { $('edit-error').textContent = error.message; }
};
$('cancel').onclick = () => $('editor').close();
$('nav').onclick = (event) => { const button = event.target.closest('[data-view]'); if (button) { view = button.dataset.view; void render(); } };
$('logout').onclick = async () => { try { await api('logout', { method: 'POST' }); } finally { ++renderVersion; committedView = null; $('content').replaceChildren(); $('content').inert = false; $('login').showModal(); } };
$('login-form').onsubmit = async (event) => { event.preventDefault(); try { const result = await api('login', { method: 'POST', body: JSON.stringify({ username: $('admin-username').value.trim(), password: $('admin-password').value }) }); $('admin-password').value = ''; mustChangePassword = result.mustChangePassword; view = mustChangePassword ? 'profile' : 'overview'; $('login').close(); await render(); } catch (error) { $('login-error').textContent = error.message; } };
$('login').addEventListener('cancel', (event) => event.preventDefault());
fetch('/health/ready').then((response) => { $('health').textContent = response.ok ? '● Serviços operacionais' : 'Serviços indisponíveis'; }).catch(() => { $('health').textContent = 'Sem conexão'; });
void api('me').then((user) => { mustChangePassword = user.mustChangePassword; view = mustChangePassword ? 'profile' : 'overview'; return render(); }).catch(() => $('login').showModal());

setInterval(() => { if (view === 'overview' && !$('login').open) void api('peers').then((data) => { const node = $('active-peers'); if (node) node.textContent = String(data.connections); }).catch(() => {}); }, 5000);

setInterval(() => { if (['seeds', 'monitoring'].includes(view) && !$('login').open && !$('editor').open) void render(); }, 5000);
