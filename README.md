# Highpass — ecossistema IPTV P2P

Engine Fastify, painel administrativo, WebPlayer React e aplicativo Kotlin para Android TV/celular e clientes Tizen, webOS e Roku. Origem: **http://xuione.remoto.api.br**. Engine pública configurada: **https://p2p.remoto.api.br**. Os clientes solicitam somente **usuário e senha da linha XUI**.

## 1. Arquitetura do ecossistema

```text
Android TV / Android Mobile                   WebPlayer React
ExoPlayer + DataSource P2P                     hls.js + HlsJsP2PEngine
             │                                     │
             └────────── HTTPS / WSS ──────────────┘
                                  │
                          Nginx → Fastify
                                  ├→ XUI Player API: validação + catálogo + EPG
                                  ├→ Proxy HLS/VOD: URLs opacas, sessão obrigatória
                                  ├→ Tracker WebTorrent privado: ofertas/respostas
                                  ├→ Redis: sessões cifradas, grants e presença
                                  └→ Drizzle / PostgreSQL: configuração e auditoria

WebPlayer ←──── WebRTC DataChannels / segmentos ────→ Android
                  HTTP de origem como fallback

/metrics → Prometheus → Grafana provisionado
migration-runner → advisory lock PostgreSQL → drizzle/*.sql
```

Arquitetura modular com Clean Architecture simplificada: `Routes + DTO Zod → Controller → Service → Repository → Drizzle/pg ou Redis`. O módulo IPTV usa rotas como controladores de transporte e recebe suas dependências explicitamente; módulos de administração e CRUD mantêm controllers/repositories separados. Drizzle usa `pg.Pool`, sem engine externa. Rede assíncrona, pools, paginação, filas e buffers têm limites explícitos; desempenho deve ser medido sob carga real, sem promessa de overhead zero.

O transporte P2P usa **p2p-media-loader 4 nos dois clientes**. No Android, ExoPlayer decodifica o vídeo; uma WebView sem player executa o mesmo Core JS para interoperar com o WebPlayer. Os segmentos chegam a uma DataSource nativa por blocos limitados. A opção evita implementar um protocolo WebRTC incompatível no Kotlin. O tracker privado opera sobre Redis entre instâncias; o vídeo circula entre peers, com fallback HTTP pelo backend.

## 2. Estrutura entregue

A árvore completa está em [docs/file-tree.md](docs/file-tree.md). O repositório inclui todos os fontes, lockfile, wrapper Gradle, SQL e snapshots Drizzle, testes, Docker, Nginx, PM2, dashboards e workflow.

```text
src/                     Engine Node.js e API administrativa
  modules/iptv/          Sessão XUI, catálogo, mídia, tracker e UI
  modules/admin/         CRUD de origens, regras, parâmetros e auditoria
  db/                    Pool, schema e migrator
apps/webplayer/          React, HLS, estatísticas e ponte Android
apps/android/            Kotlin, TV/telefone, ExoPlayer e DataSource P2P
apps/tizen/              Launcher hospedado Samsung + configuração e ícone
apps/webos/              Launcher hospedado LG + appinfo e ícones
apps/roku/               BrightScript, SceneGraph e pacote Roku
public/admin/            Painel administrativo
public/player/           Saída gerada pelo build React
drizzle/                 Migrations SQL + metadados versionados
infra/nginx/             Proxy, SSL, limites e redação de logs
prometheus/              Coleta local e blue/green
grafana/provisioning/    Datasource, provider e dashboard JSON
scripts/                 Build web, deploy e troca de upstream
.github/workflows/       CI/CD + APK Android
tests/                   Unitários, integração e navegador/P2P real
```

## 3. Back-end e administração executáveis

| Arquivo | Responsabilidade |
| --- | --- |
| `src/server.ts`, `src/app.ts` | Inicialização, SIGINT/SIGTERM, erro fatal, drain e dependências |
| `src/db/index.ts`, `schema.ts`, `migrate.ts` | Pool pg, Drizzle e execução do SQL com lock |
| `src/modules/iptv/iptv.service.ts` | XUI, catálogo, sessões AES-256-GCM e autorização de mídia |
| `src/modules/iptv/iptv.routes.ts` | DTOs Zod, cookie HttpOnly/Bearer, proxy HLS/VOD com Range |
| `src/modules/iptv/tracker.ts` | Tracker WebTorrent autenticado, presença e sinalização Redis |
| `src/modules/admin/` | CRUD de XUI, tokens cifrados, chaves, whitelist e auditoria |
| `src/lib/redis.ts`, `metrics.ts` | Redis sem fila offline e métricas isoladas por instância |

Sessões IPTV consultam o XUI e não criam usuários locais. As credenciais necessárias para buscar o stream são cifradas no Redis, com expiração e revalidação periódica; não ficam no banco de usuários do serviço. Os módulos REST/JWT/refresh-token/notes originais continuam disponíveis como exemplo independente de CRUD.

O painel fica em `/admin`, com chave de operador. Os clientes IPTV usam a origem fixa em `XUI_BASE_URL`; o CRUD de origens/regras também atende o plano de controle anterior. [O guia do ecossistema](docs/ecosystem.md) explica essa relação, a API e os limites. [O guia administrativo](docs/p2p-observability.md) detalha as operações do painel.

## 4. WebPlayer e Android TV/Mobile

WebPlayer em `/player/`: login com dois campos, menu ao vivo/filmes/séries/favoritos/configurações/conta, busca, categorias, paginação, EPG e painel de peers, tráfego e economia. Interface própria Highpass, inspirada na organização solicitada. Favoritos são locais por conta; senha/token não são persistidos no localStorage. Player central: `apps/webplayer/src/components/P2PVideoPlayer.tsx`.

Android: `LoginActivity.kt`, `HomeActivity.kt`, `PlayerActivity.kt`, `P2PBridge.kt` e `P2PDataSource.kt`. Navegação por D-pad e toque, descoberta de episódios, favoritos, conta e opção de P2P. Sessão armazenada com Android Keystore. Engine e origem ficam no BuildConfig, sem campo de URL no login.

Com JDK 17, Android SDK 35 e build-tools 35.0.0:

```bash
apps/android/gradlew -p apps/android :app:assembleDebug :app:testDebugUnitTest
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

O APK padrão aponta para `https://p2p.remoto.api.br`. Para emulador acessando o backend local:

```bash
apps/android/gradlew -p apps/android :app:assembleDebug -PengineUrl=http://10.0.2.2:3000
```

O APK debug é instalável; distribuição em loja exige assinatura release própria. Os endereços de produção são fixos por build. Os acessos administrativos gerados para o servidor ficam somente em `/opt/highpass/access.txt`, com permissão 0600.

## 5. Execução, CI/CD e validação

```bash
cp .env.example .env
docker compose up -d --build --wait
docker compose logs migration-runner
curl --fail http://127.0.0.1:3000/health/ready
```

| Serviço | Acesso local |
| --- | --- |
| WebPlayer | http://127.0.0.1:3000/player/ |
| Administração | http://127.0.0.1:3000/admin |
| Prometheus | http://127.0.0.1:9090 |
| Grafana | http://127.0.0.1:3003 |

Admin local: `admin` / `admin`, com troca obrigatória da senha inicial no perfil. Chaves de API continuam disponíveis para automação. Grafana local: `admin` / `local-grafana-change-before-production`. Use uma linha XUI válida no WebPlayer; dados de teste não são contas da origem real.

Desenvolvimento com Node 22:

```bash
npm ci
npx drizzle-kit generate
docker compose up -d --wait postgres redis
npm run db:migrate
npm run build:web
npm run dev
```

Em outra shell, `npm run dev:web` inicia o Vite em `http://127.0.0.1:5173/player/`, com proxy HTTP/WebSocket para a engine local. `npm run build` compila WebPlayer e backend; `npm start` usa o resultado.

O SQL inicial já está em `drizzle/`. Para evoluir: altere `src/db/schema.ts`, rode `npx drizzle-kit generate --name nome_da_alteracao`, revise SQL e versione toda a pasta. O runner espera o healthcheck do PostgreSQL e termina antes do app. Para reaplicar em ambiente existente: `docker compose run --rm --no-deps migration-runner`, seguido de `docker compose up -d --wait app`.

CI: **lint/tipos + pacotes TV → testes PostgreSQL/Redis + navegador/P2P e build Android → imagem GHCR SHA/latest → deploy SSH em main**. A entrada é `.github/workflows/deploy.yml`, que chama `ci-cd.yml`. O deploy usa fingerprint, credenciais temporárias do registry, migrations, slot inativo blue/green, readiness e troca Nginx. Simples recriação Compose não garante continuidade; os scripts entregues mantêm a instância anterior até a nova estar pronta. WebSockets reconectam após a drenagem. Migrations devem ser compatíveis com os dois slots.

Configure `HOST`, `USERNAME`, `SSH_PRIVATE_KEY`, `PORT`, `GHCR_TOKEN` e `SSH_HOST_FINGERPRINT` no environment GitHub `production`. [docs/production.md](docs/production.md) contém o passo a passo de SSH, secrets, DNS, SSL, infraestrutura, primeiro deploy e rollback.

Resultados e comandos reproduzíveis: [docs/validation.md](docs/validation.md). O teste de vídeo usa uma origem XUI simulada e HLS gerado pelo FFmpeg. Houve transferência real WebRTC entre WebPlayer e ponte Android em Chromium; compilação e testes JVM do APK também foram executados. Credenciais reais XUI e reprodução em aparelho Android ainda precisam de homologação.

A origem solicitada usa HTTP entre engine e XUI. STUN está configurado; redes que exigem relay precisam de TURN próprio em `RTC_ICE_SERVERS`. O P2P pressupõe segmentos e chaves idênticos entre linhas. Codecs, DRM, NAT e variantes da API XUI devem ser homologados. FFmpeg faz remux VOD sob demanda, sem transcodificação.

Referências: [p2p-media-loader](https://github.com/Novage/p2p-media-loader), [Media3 DataSource](https://developer.android.com/media/media3/exoplayer/customization), [Fastify](https://fastify.dev/docs/latest/Reference/Server/), [Drizzle migrations](https://orm.drizzle.team/docs/migrations).


## Extensão Smart TV, VOD e métricas

[docs/smart-tv-production.md](docs/smart-tv-production.md) contém a matriz de compatibilidade, execução e empacotamento TV, definição dos percentuais e operação do gateway Roku. Filmes e episódios são preparados em HLS sob demanda com FFmpeg para participar da mesma distribuição P2P dos canais. Roku recebe HLS do gateway; o badge distingue explicitamente o trecho gateway → swarm.

```bash
npm run build:tv
```

Isso valida/empacota BrightScript e gera o IPK webOS. Tizen contém launcher/configuração e WGT sem assinatura; assinatura de distribuição exige certificado Samsung. Os pacotes Android/TV são artefatos de desenvolvimento e precisam de homologação nos modelos físicos utilizados.
