# Clientes IPTV e protocolo interoperável

## Endereços e login

A engine pública configurada é `https://p2p.remoto.api.br`; o WebPlayer de produção fica em `https://p2p.remoto.api.br/player/` e o painel em `/admin`. A origem fixa é `http://xuione.remoto.api.br`. DNS, certificado e deploy precisam ser ativados conforme [produção](production.md). Não há campo de servidor no login.

O WebPlayer é servido pela própria engine e usa API da mesma origem. O Android recebe `ENGINE_URL` e `XUI_BASE_URL` no BuildConfig. Para trocar o destino de uma build Android use `-PengineUrl=https://p2p.remoto.api.br`. A URL XUI não é consultada diretamente pelo aplicativo: senha e mídia passam pela engine.

1. `POST /api/iptv/login` recebe apenas `{ "username": "linha", "password": "senha" }`.
2. O serviço consulta `player_api.php` da origem configurada e exige `user_info.auth=1`, estado ativo e validade.
3. Retorna sessão opaca e conta normalizada. Browser usa cookie `HP_SESSION` HttpOnly/SameSite=Strict/Secure em produção; Android usa Bearer com o mesmo token opaco.
4. Credenciais XUI ficam em uma sessão Redis AES-256-GCM. Não há criação de usuário IPTV em PostgreSQL. A conta é identificada por HMAC; o token é armazenado como SHA-256.
5. Sessão vale no máximo 24h ou a expiração da linha, o que vier antes. A origem é revalidada após cinco minutos de uso. Redis reiniciado encerra as sessões. Não há refresh JWT nesse fluxo: o cliente entra novamente ao expirar. O módulo REST/JWT anterior é independente.
6. Logout remove a sessão e os grants; mídia deixa de funcionar e o tracker fecha a conexão na próxima mensagem/heartbeat. Bytes já recebidos pelos peers não podem ser recolhidos.

A conta mostrada informa o limite de conexões XUI e o prazo da sessão local. Não é uma cópia de cadastro/assinatura da origem. A engine limita conexões de tracker por conta ao menor valor entre 20 e o limite informado pelo XUI. O XUI continua responsável pelo controle dos acessos HTTP de origem; P2P não garante correspondência entre sockets, dispositivos e contagem comercial de conexões.

## API dos clientes

Todas as rotas abaixo, exceto login e arquivos do player, exigem a sessão. Envie `Authorization: Bearer TOKEN` no Android; browser envia cookie automaticamente.

| Método | Caminho | Comportamento |
| --- | --- | --- |
| POST | `/api/iptv/login` | Autentica na origem; não replica usuário |
| GET | `/api/iptv/account` | Conta e expiração da sessão |
| POST | `/api/iptv/logout` | Revoga sessão e grants |
| GET | `/api/iptv/catalog?kind=live&offset=0&limit=100` | `kind=live`, `movie` ou `series`; busca/categoria opcionais |
| GET | `/api/iptv/categories?kind=live` | Categorias da linha |
| GET | `/api/iptv/series/:id` | Episódios de série autorizada |
| GET | `/api/iptv/epg/:id` | Até oito programas; decodifica título/descrição base64 |
| POST | `/api/iptv/playback` | `{kind,id,seriesId?}`; valida pertencimento ao catálogo |
| GET | `/api/iptv/media/:grant/:resource` | Playlist, chave ou bytes, restritos à sessão proprietária |
| WS | `/api/iptv/tracker/:grant` | Tracker privado com cookie ou Bearer proprietário |

`playback` retorna URL de mídia relativa, `swarmId`, `trackerPath`, `iceServers`, configuração e flags `isLive`/`isHls`. Não retorna credenciais da origem. Live usa `/live/USER/PASS/ID.m3u8`; filme `/movie/...` e episódio `/series/...` usam a extensão do catálogo. Instalações XUI que mudam esses contratos precisam adaptar `iptv.service.ts` e passar pela homologação.

O backend valida hosts e protocolos em cada redirect, permite no máximo três redirects e não é um proxy arbitrário. Configure os balanceadores legítimos em `XUI_ALLOWED_HOSTS`. `XUI_ALLOW_HTTP=true` autoriza a origem HTTP solicitada. URLs de recurso são cifradas com AES-SIV (RFC 5297), estáveis para a mesma URL/grant, e vinculadas a um grant; conhecer uma URL sem possuir sua sessão não libera a mídia. Logs fornecidos omitem esses parâmetros.

Playlists HLS reescrevem variantes, segmentos, mapas e `URI` de chaves para URLs da engine. VOD preserva Range e respostas 206, sem bufferizar arquivos inteiros. Cada sessão mantém no máximo quatro grants ativos; novas seleções removem os mais antigos. Sessão/grant expiram juntos. O proxy não altera codecs e não implementa DRM. O novo VodManager remuxa arquivos VOD em HLS sem reencodificar.

Limites iniciais: quatro consultas JSON de origem simultâneas por processo; resposta JSON até 8 MiB; catálogo normalizado até 30 mil itens; cache de até oito catálogos por 30s; paginação até 200 itens; playlist até 1 MiB. Eles são barreiras de memória e podem precisar de ajuste com catálogos reais. Backpressure de streaming evita manter o vídeo inteiro no heap.

## Interoperabilidade Web ↔ Android

O WebPlayer usa `HlsJsP2PEngine.injectMixin(Hls)` da versão 4.0.0. O Android usa o mesmo `p2p-media-loader-core` empacotado em `/player/android-bridge.html`. Uma WebView de 1px, sem vídeo, mantém WebRTC; ExoPlayer/Media3 continua sendo o decoder e a interface de vídeo nativos.

A DataSource Kotlin observa playlists que ExoPlayer carregou, registra variantes/segmentos no Core e tenta carregar segmentos registrados por ele. A identidade externa usa sequência HLS ao vivo ou índice de VOD; intervalos de bytes integram a identidade local. `swarmId` é derivado da origem, tipo e conteúdo, sem senha. Metadados de variantes distinguem streams. Isso permite que URLs opacas e sessões diferentes compartilhem os mesmos bytes de um conteúdo autorizado.

A ponte entrega blocos base64 de até 32 KiB para um acumulador Kotlin limitado a 16 MiB por pedido, com até quatro pedidos pendentes. O cache Core Android é de 32 MiB; o WebPlayer limita seu cache a 64 MiB. Chamadas esperam fora da main thread; os tempos máximos encerram a tentativa e ExoPlayer volta ao HTTP. O Core também pode buscar HTTP como fallback. WebView exige Android System WebView atualizado com WebRTC disponível.

P2P está habilitado para HLS ao vivo e sob demanda. Filmes/episódios não HLS passam por remux FFmpeg sob demanda; a ponte Android também os distribui por P2P. O usuário pode desligar P2P nas configurações. Favoritos e preferência são locais, separados por conta; não há sincronização entre dispositivos. O Android guarda somente o token opaco cifrado com Android Keystore, nunca a senha XUI.

O tracker implementa `announce`, `offers` e `answer` do protocolo WebTorrent. Cada requisição é autorizada pelo grant antes do upgrade. A realm combina o conteúdo autorizado com o `info_hash`, isolando canais. Redis TTL/heartbeat e Pub/Sub permitem sinalizar peers em instâncias diferentes. Não são configurados trackers públicos. Ofertas e SDP têm limites, assim como variantes, fila, taxa de mensagens, conexões e buffer de saída. O protocolo customizado anterior em `/p2p/ws` permanece disponível para integrações antigas e não é usado por esses players.

`RTC_ICE_SERVERS` é um array JSON compartilhado entre clientes:

```dotenv
RTC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
```

Para redes que precisam de relay, acrescente seu TURN com `urls`, `username` e `credential`. Não há servidor TURN incluído. Credenciais TURN retornadas ao cliente são visíveis a ele; para operação maior, use credenciais temporárias emitidas pelo operador em vez de um segredo de longa duração. O fallback HTTP mantém a reprodução quando não há conexão P2P.

O WebRTC pode usar UDP ou relay conforme negociação/rede. Não é um transporte UDP Kotlin separado. A compatibilidade foi comprovada com HLS MPEG-TS simples; valide variantes ABR, áudio separado, descontinuidades, byterange, criptografia, codecs e versões WebView usadas na sua base. Segmentos com watermark, conteúdo personalizado ou chaves diferentes por linha não podem compartilhar a mesma swarm.

## Administração e métricas

O painel CRUD de servidores XUI, canais/regras/fallbacks, chaves, whitelist e parâmetros permanece em `/admin`. Para os novos clientes a origem é fixa em `XUI_BASE_URL`; cadastrar outra origem não muda silenciosamente o destino do login. Regras multi-origem continuam atendendo `/p2p/authorize`, do plano de controle anterior. Parâmetros de buffer/conexões/peers são consumidos pelos clientes novos; o limite de upload informado é orientativo, não um shaping garantido de tráfego WebRTC.

O WebPlayer e a ponte Android medem peers e bytes HTTP/P2P pelos eventos do Core. O painel de economia é local à sessão de reprodução. O backend não observa os bytes diretos dos DataChannels; Prometheus exporta processo, HTTP, WebSocket e métricas do plano de controle. O dashboard não inventa economia P2P do cliente como métrica do servidor. `/metrics` exige Bearer próprio e é bloqueado pelo Nginx público. Veja [monitoramento](p2p-observability.md).

## Build e testes

```bash
npm ci
npm run typecheck
npm run typecheck:web
npm run lint
npm run build
```

Para testes, use um PostgreSQL 16 e Redis 7 exclusivos e exporte as variáveis descritas em [validação](validation.md). `npm run test:browser` precisa de FFmpeg e Chromium Playwright:

```bash
npx playwright install --with-deps chromium
npm test
npm run db:migrate
npm run test:integration
npm run test:browser
```

O teste produz HLS sintético, abre WebPlayer e a ponte Android em contextos isolados, bloqueia HTTP de segmentos no receptor e compara SHA-256 dos dados P2P. Não usa uma playlist pública, contas reais ou contadores simulados. É teste da ponte JS e do transporte; testes JVM verificam o acumulador Kotlin. A reprodução em hardware Android TV/mobile ainda deve ser homologada.

Fontes técnicas: [Core e HLS.js da Novage](https://github.com/Novage/p2p-media-loader), [DataSources do Media3](https://developer.android.com/media/media3/exoplayer/customization), [WebView JavascriptInterface](https://developer.android.com/reference/android/webkit/WebView#addJavascriptInterface(java.lang.Object,%20java.lang.String)).
