const $ = (id) => document.getElementById(id);
let mustChangePassword = false;
let view = 'overview';
let editing = null;
const titles = { overview: 'Visão geral', 'xui-servers': 'Servidores XUI ONE', routes: 'Roteamento de canais', config: 'Parâmetros P2P', keys: 'Chaves de API', whitelist: 'Whitelist de IPs', audit: 'Auditoria', profile: 'Meu perfil' };
const definitions = {
  'xui-servers': [['name', 'Nome', 'text'], ['baseUrl', 'URL base autorizada', 'url'], ['apiToken', 'Token de API (vazio mantém o atual)', 'password'], ['enabled', 'Habilitado', 'checkbox']],
  routes: [['channel', 'Identificador do canal', 'text'], ['streamId', 'ID do stream XUI', 'number'], ['serverId', 'UUID do servidor principal', 'text'], ['fallbackServerIds', 'UUIDs de fallback, separados por vírgulas', 'text'], ['enabled', 'Habilitado', 'checkbox']],
  config: [['bufferSeconds', 'Buffer em segundos', 'number'], ['maxUploadKbps', 'Upload por peer em Kbps (informado ao cliente)', 'number'], ['maxConnectionsPerNode', 'Conexões por linha', 'number'], ['maxPeersPerChannel', 'Peers por canal', 'number']],
  keys: [['name', 'Nome da chave', 'text']], whitelist: [['cidr', 'IP ou CIDR', 'text']],
};
const columns = { 'xui-servers': ['name', 'baseUrl', 'enabled', 'hasApiToken', 'id'], routes: ['channel', 'streamId', 'serverId', 'enabled'], keys: ['name', 'id', 'createdAt'], whitelist: ['cidr', 'id'], audit: ['createdAt', 'actor', 'action', 'resource', 'ip'] };
async function api(path, options = {}) {
  const response = await fetch('/api/admin/' + path, { ...options, headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) } });
  if (response.status === 204) return null;
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || 'Operação recusada');
  return value;
}
function element(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
async function render() {
  $('title').textContent = titles[view]; $('notice').textContent = ''; $('content').replaceChildren();
  document.querySelectorAll('nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  try {
    if (view === 'profile') {
      const panel = element('form', undefined, 'panel'); panel.append(element('h2', 'Alterar senha'), element('p', mustChangePassword ? 'Defina uma senha própria para liberar a operação.' : 'A alteração encerra suas outras sessões.'));
      for (const [name, label] of [['currentPassword', 'Senha atual'], ['newPassword', 'Nova senha (12 caracteres ou mais)']]) { const field = element('label', label); const input = element('input'); input.type = 'password'; input.name = name; input.required = true; input.maxLength = 256; input.minLength = name === 'newPassword' ? 12 : 1; input.autocomplete = name === 'newPassword' ? 'new-password' : 'current-password'; field.append(input); panel.append(field); }
      const save = element('button', 'Salvar nova senha', 'primary'); panel.append(save);
      panel.onsubmit = async (event) => { event.preventDefault(); try { await api('change-password', { method: 'PUT', body: JSON.stringify({ currentPassword: panel.elements.currentPassword.value, newPassword: panel.elements.newPassword.value }) }); mustChangePassword = false; view = 'overview'; await render(); $('notice').textContent = 'Senha alterada.'; } catch (error) { $('notice').textContent = error.message; } };
      $('content').append(panel); return;
    }
    if (view === 'overview') {
      const [servers, routes, events, peers] = await Promise.all(['xui-servers', 'routes', 'audit', 'peers'].map((path) => api(path)));
      const cards = element('div', undefined, 'cards');
      for (const [label, value] of [['Servidores cadastrados', servers.length], ['Canais roteados', routes.length], ['WebSockets ativos', peers.connections], ['Eventos recentes', events.length]]) { const card = element('div', undefined, 'card'); const counter = element('strong', String(value)); if (label === 'WebSockets ativos') counter.id = 'active-peers'; card.append(element('p', label), counter); cards.append(card); }
      const panel = element('div', undefined, 'panel'); panel.append(element('h2', 'Uma origem. Uma rede de peers.'), element('p', 'Cadastre uma origem XUI ONE autorizada, associe seus canais e ajuste os limites da engine. Cada linha é validada na origem antes de receber um ticket de sinalização.'), element('p', 'Prometheus coleta a API e os processos Node.js. O dashboard provisionado do Grafana reúne CPU, memória, HTTP e conexões WebSocket.'));
      $('content').append(cards, panel); return;
    }
    const rows = await api(view);
    if (view === 'config') {
      const panel = element('div', undefined, 'panel');
      for (const [name, label] of definitions.config) panel.append(element('p', `${label}: ${rows[name]}`));
      const edit = element('button', 'Editar parâmetros', 'primary'); edit.onclick = () => openEditor(rows); panel.append(edit); $('content').append(panel); return;
    }
    const toolbar = element('div', undefined, 'toolbar'); toolbar.append(element('span', `${rows.length} registros`));
    if (view !== 'audit') { const button = element('button', '+ Adicionar', 'primary'); button.onclick = () => openEditor(null); toolbar.append(button); }
    $('content').append(toolbar);
    if (!rows.length) { $('content').append(element('div', 'Nenhum registro. Adicione a primeira configuração.', 'empty')); return; }
    const wrap = element('div', undefined, 'table-wrap'); const table = element('table'); const header = element('tr');
    columns[view].forEach((name) => header.append(element('th', name))); if (view !== 'audit') header.append(element('th', 'Ações')); table.append(header);
    rows.forEach((row) => {
      const tr = element('tr'); columns[view].forEach((name) => tr.append(element('td', typeof row[name] === 'boolean' ? (row[name] ? 'Sim' : 'Não') : String(row[name] ?? ''))));
      if (view !== 'audit') {
        const actions = element('td');
        if (definitions[view]) { const edit = element('button', 'Editar'); edit.onclick = () => openEditor(row); actions.append(edit); }
        if (view === 'xui-servers' && row.hasApiToken) {
          const clear = element('button', 'Remover token');
          clear.onclick = async () => { try { await api(`xui-servers/${row.id}`, { method: 'PUT', body: JSON.stringify({ name: row.name, baseUrl: row.baseUrl, enabled: row.enabled, apiToken: '' }) }); await render(); } catch (error) { $('notice').textContent = error.message; } }; actions.append(clear);
        }
        const remove = element('button', 'Excluir'); remove.onclick = async () => { if (!confirm('Excluir este registro?')) return; try { await api(`${view}/${encodeURIComponent(row.id ?? row.channel)}`, { method: 'DELETE' }); await render(); } catch (error) { $('notice').textContent = error.message; } }; actions.append(remove); tr.append(actions);
      }
      table.append(tr);
    }); wrap.append(table); $('content').append(wrap);
  } catch (error) { $('notice').textContent = error.message; }
}
function openEditor(row) {
  editing = row; $('fields').replaceChildren(); $('edit-error').textContent = ''; $('edit-title').textContent = (row ? 'Editar · ' : 'Adicionar · ') + titles[view];
  definitions[view].forEach(([name, label, type]) => {
    const field = element('label', label); const input = element('input'); input.name = name; input.type = type;
    if (type === 'checkbox') input.checked = row ? Boolean(row[name]) : true;
    else { input.value = Array.isArray(row?.[name]) ? row[name].join(', ') : (row?.[name] ?? ''); input.required = !['apiToken', 'fallbackServerIds'].includes(name); }
    if (type === 'number') { input.min = '1'; input.step = '1'; }
    if (type === 'password') input.autocomplete = 'off';
    if (name === 'channel' && row) input.readOnly = true;
    field.append(input); $('fields').append(field);
  }); $('editor').showModal();
}
$('edit-form').onsubmit = async (event) => {
  event.preventDefault(); const body = {};
  for (const [name, , type] of definitions[view]) {
    const input = $('edit-form').elements.namedItem(name);
    if (name === 'apiToken' && !input.value) continue;
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
$('logout').onclick = async () => { try { await api('logout', { method: 'POST' }); } finally { $('content').replaceChildren(); $('login').showModal(); } };
$('login-form').onsubmit = async (event) => { event.preventDefault(); try { const result = await api('login', { method: 'POST', body: JSON.stringify({ username: $('admin-username').value, password: $('admin-password').value }) }); $('admin-password').value = ''; mustChangePassword = result.mustChangePassword; view = mustChangePassword ? 'profile' : 'overview'; $('login').close(); await render(); } catch (error) { $('login-error').textContent = error.message; } };
$('login').addEventListener('cancel', (event) => event.preventDefault());
fetch('/health/ready').then((response) => { $('health').textContent = response.ok ? '● Serviços operacionais' : 'Serviços indisponíveis'; }).catch(() => { $('health').textContent = 'Sem conexão'; });
void api('me').then((user) => { mustChangePassword = user.mustChangePassword; view = mustChangePassword ? 'profile' : 'overview'; return render(); }).catch(() => $('login').showModal());

setInterval(() => { if (view === 'overview' && !$('login').open) void api('peers').then((data) => { const node = $('active-peers'); if (node) node.textContent = String(data.connections); }).catch(() => {}); }, 5000);
