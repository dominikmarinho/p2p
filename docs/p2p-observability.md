# Engine P2P, administração e observabilidade

Esta evolução implementa o escopo do anexo `highpass-p2p-engine` dentro do projeto existente em `highpass-microservice/`. O nome npm agora é `highpass-p2p-engine`; os endpoints REST/JWT anteriores continuam disponíveis.

## 1. Arquitetura e fluxo

```text
Operador → /admin → /api/admin/* → Admin Controller / Services → PostgreSQL
                                     ├→ xui_servers (token AES-256-GCM)
                                     ├→ stream_routes / p2p_config
                                     └→ admin_keys / admin_whitelist / audit_logs

Cliente → POST /p2p/authorize (canal, usuário, senha)
          → regra cadastrada → XuiAuthService
          → GET player_api.php + HEAD do stream (GET se HEAD não suportado)
          → validação positiva → ticket opaco de uso único (30s, Redis)
          → WS /p2p/ws?ticket=... → PeerManager → presença/swarm no Redis
          → offer / answer / ice → Redis Pub/Sub → instância do peer de destino

Fastify /metrics → Prometheus (15s) → Grafana provisionado
                   ├→ produção: p2p-blue:3000 + p2p-green:3000
                   └→ desenvolvimento: app:3000
```

O microsserviço implementa o plano de controle e a sinalização. Os segmentos de vídeo/dados WebRTC são responsabilidade do cliente/player e da origem; não são retransmitidos pelo servidor WS. Buffer e upload são parâmetros enviados ao player. O servidor limita efetivamente conexões por linha, peers por canal, mensagens, payloads e backpressure; limitar bytes do tráfego direto entre peers requer implementação no player ou TURN/relay próprio. Os clientes Web/Android e o tracker compatível foram acrescentados nesta entrega; veja [ecossistema](ecosystem.md). O protocolo descrito nesta seção é o plano de controle anterior; os players novos usam `/api/iptv/tracker/:grant`. TURN não é hospedado pelo projeto.

## 2. Arquivos e migrations

A árvore completa está em `docs/file-tree.md`. Foram adicionados `src/modules/admin/`, `src/services/xui-auth.service.ts`, `src/services/peer-manager.ts`, `src/ws/peer.handler.ts`, `public/admin/`, `prometheus/` e `grafana/provisioning/`.

`drizzle/0001_p2p_control_plane.sql` cria as tabelas adicionais sem remover as anteriores. A alteração foi gerada pelo drizzle-kit; SQL, journal e snapshot estão versionados juntos. O runner continua aplicando migrations antes de iniciar a aplicação:

```bash
npm ci
npx drizzle-kit generate
docker compose build
docker compose up -d --wait postgres redis
docker compose run --rm --no-deps migration-runner
docker compose up -d --wait
```

Não remova a migration inicial nem substitua a história de um banco existente.

## 3. Setup local e uso do painel

```bash
cp .env.example .env
docker compose up -d --build --wait
```

| Interface | Endereço local |
| --- | --- |
| Painel administrativo | `http://127.0.0.1:3000/admin` |
| API administrativa | `http://127.0.0.1:3000/api/admin` |
| Readiness | `http://127.0.0.1:3000/health/ready` |
| Prometheus | `http://127.0.0.1:9090` |
| Grafana | `http://127.0.0.1:3003` |

No painel atual, use usuário/senha. Em desenvolvimento o seed é `admin/admin`, com troca obrigatória no perfil; em produção a senha inicial é aleatória e fica no arquivo privado `/opt/highpass/access.txt`. Sessões administrativas usam cookie HttpOnly. A API também aceita `x-api-key` para automação/recuperação, mantendo `ADMIN_BOOTSTRAP_KEY` e as chaves de operação existentes. O painel permite criar/editar/excluir servidores, salvar regras e fallbacks, ajustar parâmetros P2P, criar/revogar chaves, manter whitelist e consultar auditoria. Tokens XUI ficam cifrados no PostgreSQL e não voltam nas listagens; uma chave nova aparece apenas na criação.

Use o login de Grafana definido em `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD`. No exemplo local: `admin` / `local-grafana-change-before-production`. O dashboard **Fastify P2P Engine - Dashboard** aparece na pasta **Highpass**. As portas 3001/3002 ficam reservadas ao deploy blue/green; Grafana usa 3003.

Antes de cadastrar uma origem, inclua seu **host e porta exatos** em `XUI_ALLOWED_HOSTS` e recrie o app. Exemplo: `xui.example.com,lb.example.com:8443`. HTTPS é o padrão; para HTTP em rede controlada, defina explicitamente `XUI_ALLOW_HTTP=true`. Não basta cadastrar a URL no painel para autorizar chamadas a qualquer endereço. O painel rejeita host fora da allowlist e URLs com credenciais/query string embutidas.

1. Em **Servidores XUI ONE**, cadastre nome e URL base. Para a Admin API, informe o **Access Code do tipo Admin API** criado em Access Codes do XUI e a **API Key do administrador XUI** gerada no perfil desse administrador. Campos em branco ao editar mantêm o valor salvo. Use **Testar Admin API** depois de salvar: o servidor consulta apenas `get_servers`, sem alterar dados no XUI. O teste requer permissão para essa ação e o IP do servidor P2P liberado no XUI, quando houver restrição de IP.
2. Em **Roteamento de canais**, associe um identificador local ao ID de stream e ao UUID da origem. Configure até três origens de fallback.
3. Em **Parâmetros P2P**, ajuste buffer, upload anunciado ao cliente e limites de conexões/peers.
4. Em **Chaves do Control Plane**, gere chaves para automações da API administrativa do próprio P2P. Em **Whitelist**, restrinja IPs/CIDRs dessas chaves. A API Key do XUI pertence ao cadastro de servidor do item 1; as chaves locais geradas pelo P2P são credenciais independentes.

O teste administrativo faz `GET /ACCESS_CODE/?api_key=API_KEY&action=get_servers` no backend. Access Code e API Key são cifrados separadamente no banco; a listagem informa apenas se estão configurados. Credenciais não são devolvidas ao navegador nem incluídas em auditoria/erros. A coluna cifrada legada foi preservada para compatibilidade de migrations; credenciais antigas precisam ser classificadas antes de migrar para os novos campos. A autenticação das linhas continua na Player API com usuário/senha.

Uma whitelist vazia permite qualquer IP que possua uma chave válida. A chave bootstrap ignora a whitelist para recuperação administrativa e deve permanecer sob controle do operador. Eventos de escrita concluídos são persistidos em `audit_logs` sem corpos, senhas ou tokens. O banco deve estar saudável para concluir a auditoria da resposta. Operações de configuração e a auditoria HTTP são gravações separadas; em falha de auditoria, o cliente recebe erro e deve consultar o estado antes de repetir uma escrita.

## 4. Protocolo P2P

Exemplo de autorização:

```bash
curl -X POST http://127.0.0.1:3000/p2p/authorize \
  -H 'Content-Type: application/json' \
  -d '{"channel":"canal-1","username":"sua-linha","password":"sua-senha"}'
```

O retorno contém `ticket`, `expiresIn: 30` e `websocketPath: /p2p/ws`. Abra o WebSocket com esse ticket. Ele é consumido atomicamente com `GETDEL`. Não envie credenciais da linha no endereço do WebSocket. O evento inicial é:

```json
{
  "type": "welcome",
  "peerId": "UUID-do-peer",
  "channel": "canal-1",
  "peers": ["UUID-de-outro-peer"],
  "config": {
    "bufferSeconds": 15,
    "maxUploadKbps": 2048,
    "maxConnectionsPerNode": 4,
    "maxPeersPerChannel": 256
  }
}
```

Envie `{"type":"ping"}` para receber `{"type":"pong"}`. Para sinalização, envie `{"type":"signal","to":"UUID-do-destino","data":{"kind":"offer","payload":"SDP"}}`. `kind` também aceita `answer` e `ice`; `payload` é uma string de até 6.000 caracteres. O destinatário recebe o mesmo conteúdo com `from` no lugar de `to`. O servidor verifica que ambos pertencem ao mesmo canal. Redis Pub/Sub entrega o sinal inclusive quando os sockets estão em containers/hosts diferentes na mesma infraestrutura Redis.

Há limite de 20 mensagens/s por conexão e uma operação de mensagem em processamento; clientes devem controlar o ritmo de envio. Presença Redis vence em 75s e é renovada com heartbeat. O registro de peers e os limites de conexões são atômicos via Lua. A autorização é reavaliada ao abrir nova sessão e dura no máximo 15 minutos, limitada também pela expiração da linha. Cache de validação dura no máximo 30s, identificado por HMAC de credenciais/origem/stream. Usuário e senha não são gravados em claro no Redis.

A integração entregue assume o contrato Player API compatível com `player_api.php`: `user_info.auth = 1`, estado ativo e expiração válida; depois verifica acesso a `/live/USER/PASS/STREAM.ts`. HEAD com 405 usa GET e cancela o body após os headers, sem consumir o stream. Redirects do stream são seguidos manualmente, no máximo três, somente para hosts permitidos. As credenciais da Admin API não são encaminhadas à Player API ou aos streams. Respostas JSON têm limite de 64 KiB e cada chamada tem timeout de 3s. Instalações XUI com API/path/header diferentes precisam adaptar esse serviço e passar pelos testes com sua origem real. Fallback trata falhas de rede/5xx; uma negativa de autenticação não procura uma origem que aceite a linha.

## 5. Prometheus, Grafana e produção

`prometheus/prometheus.yml` implementa o scrape local pedido, com `job_name=fastify_p2p_app`, serviço `p2p-engine`, intervalo 15s e rota `/metrics`. `prometheus/prometheus.prod.yml` usa aliases explícitos para os dois slots de produção. O slot parado aparece com `up=0`; considere `max(up{job="fastify_p2p_app"})` ao criar alertas de disponibilidade do serviço, para não alertar sobre o slot inativo.

`/metrics` exige `Authorization: Bearer METRICS_TOKEN`; não usa JWT de cliente. Prometheus recebe esse token via ambiente e cria um arquivo privado em seu `/tmp` antes de iniciar. O token não fica no YAML versionado. A configuração Nginx bloqueia `/metrics` no site público. Grafana de produção está disponível em **https://p2p.remoto.api.br/grafana/**, com autenticação própria e cookies seguros. O Compose configura `root_url` com o prefixo e `serve_from_sub_path=true`; Nginx mantém esse caminho ao encaminhar HTTP e WebSocket. A porta 3003 continua em loopback para o proxy, por isso `dominio:3003` não é um endereço público válido. Prometheus permanece privado; use túnel SSH para acessá-lo:

```bash
ssh -L 9090:127.0.0.1:9090 deploy@seu-servidor
```

O datasource tem UID fixo `Prometheus`, igual ao JSON do dashboard. O provider é provisionado por arquivo e os mounts são somente leitura. Os gráficos usam os contadores realmente exportados; conexões WS não usam handles genéricos do Node como substituto. CPU/RSS/heap distinguem instâncias; contadores agregados usam `sum(rate(...))` e os percentis agregam buckets antes de `histogram_quantile`.

Métricas incluem `process_*`, `nodejs_*`, `http_request_duration_seconds_*`, `websocket_active_connections`, `websocket_messages_received_total`, `websocket_messages_sent_total` e `xui_auth_duration_seconds_*`. Labels HTTP usam templates de rota, sem IDs, credenciais, IPs, tickets ou identificadores de canal. O registro é isolado por instância de Fastify, inclusive nos testes.

Na preparação do servidor, configure também as novas variáveis da `.env.production.example`. Gere `ADMIN_BOOTSTRAP_KEY`, `METRICS_TOKEN` e `GRAFANA_ADMIN_PASSWORD` com `openssl rand -hex 32`; gere `CONFIG_ENCRYPTION_KEY` com o mesmo comando, mantendo exatamente 64 caracteres hexadecimais. A chave de criptografia precisa ser a mesma nas duas instâncias e deve ser preservada com o backup. Para rotacioná-la, recifre os tokens existentes antes de trocar o valor.

Depois da infraestrutura PostgreSQL/Redis, execute:

```bash
bash scripts/observability.sh
```

O script cria volumes externos de métricas/Grafana e inicia os dois serviços no projeto `highpass-monitoring`. No deploy automático, os arquivos de provisioning seguem no pacote SSH da mesma revisão; após a troca/drenagem da API, o script atualiza o monitoramento. As instâncias da API recebem aliases `p2p-blue`/`p2p-green` por `APP_SLOT`. Configurações de monitoramento vêm do diretório de release; mantenha o release montado pelos containers enquanto estiver em uso. Falha ao atualizar monitoramento retorna erro no job, mas não desfaz uma API já publicada.

Em uma instalação existente, acrescente as novas chaves ao arquivo de ambiente antes do primeiro deploy desta versão e atualize o Nginx com as novas rotas/bloqueio de métricas. Não rode novamente o gerador inicial de senhas sobre um PostgreSQL existente.

Referências: [plugin fastify-metrics](https://github.com/SkeLLLa/fastify-metrics), [configuração Prometheus](https://prometheus.io/docs/prometheus/latest/configuration/configuration/), [provisioning Grafana](https://grafana.com/docs/grafana/latest/administration/provisioning/).
