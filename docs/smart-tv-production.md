# Smart TVs, VOD, tráfego e produção

## 1. Arquitetura e compatibilidade

```text
Web / Android / Tizen / webOS → HTTPS/WSS Engine → XUI ONE
            ↕ WebRTC/DataChannels ↕               HTTP fallback
                    Swarm privado

Roku Video → HLS HTTPS → Gateway Chromium/Core → WebRTC swarm
                             └→ HTTP quando peer indisponível

Filme/episódio solicitado → FFmpeg (-c copy) → HLS incremental → swarm
```

| Cliente | Player | Transporte de vídeo compartilhado | Validação desta entrega |
| --- | --- | --- | --- |
| Web | hls.js/HTML5 | WebRTC direto quando disponível | Chromium real, live e VOD |
| Android TV/mobile | ExoPlayer + Core em WebView | WebRTC direto | APK compilado e testes JVM; ponte testada em Chromium |
| Samsung Tizen 8+ | WebPlayer hospedado | WebRTC sujeito às APIs do modelo; HTTP fallback | Launcher/configuração e WGT sem assinatura; controle testado no navegador |
| LG webOS 24+ | WebPlayer hospedado | WebRTC sujeito às APIs do modelo; HTTP fallback | IPK gerado pela CLI oficial; controle testado no navegador |
| Roku | Video SceneGraph | Gateway WebRTC; dispositivo recebe HLS HTTP | BrightScript validado/empacotado; gateway real testado com vídeo |

Roku não oferece WebRTC nativo. Reescrever uma playlist, sozinho, não transforma a TV em peer. O gateway implementado mantém um Core por reprodução, participa do swarm e entrega os bytes ao Video nativo por HLS. Os percentuais do Roku medem **gateway → swarm/origem**; o trecho gateway → TV continua sendo HTTP. Se a capacidade do gateway for atingida ou o processo não iniciar, o app continua por HTTP e os contadores refletem isso.

Os launchers Samsung/LG abrem `/player/?tv=tizen` e `/player/?tv=webos`, preservando origem HTTPS para cookies. O baseline atual é Chromium 108 (Tizen 8/webOS 24); APIs WebRTC/MSE são detectadas em execução. Certificados, codecs e suporte de cada firmware devem ser homologados. Modelos mais antigos precisam de bundle/player específico.

Referências: [Samsung Web Engine](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html), [LG Web Engine e cookies hosted](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine), [Roku WebRTC](https://partnersuccess.roku.com/hc/en-us/articles/360060167853-Does-Roku-support-WebRTC-and-Play-WebRTC-streams).

## 2. Login administrativo e clientes

O seed cria `admin_users` com scrypt e `admin/admin` apenas quando não há `ADMIN_INITIAL_PASSWORD`. A senha de fábrica exige alteração antes das operações do painel. Produção usa senha inicial aleatória de configuração, armazenada para o operador em `/opt/highpass/access.txt`, fora do Git. O perfil chama `PUT /api/admin/change-password`, valida a senha atual, exige 12 caracteres e revoga as sessões anteriores por versão de autenticação.

O painel usa cookie HttpOnly/SameSite=Strict/Secure em produção, validade de oito horas, limite de login e verificação de Origin. A chave bootstrap anterior continua reservada à recuperação/automação, com suas regras de whitelist documentadas. A visão geral atualiza conexões WebSocket a cada cinco segundos; esse contador não deve ser interpretado como usuários únicos.

Nos players, login continua solicitando apenas usuário e senha XUI. Não há seed de clientes IPTV no banco. Roku mantém token apenas na sessão; favoritos ficam no registry por accountId. Os demais clientes mantêm o comportamento descrito em [ecossistema](ecosystem.md).

## 3. Percentuais medidos

```text
baixadoTotal = bytesHTTP + bytesP2P
P2P% = bytesP2P / baixadoTotal × 100
HTTP% = 100 − P2P%
```

Antes do primeiro byte: **0% HTTP / 0% P2P**. Os valores derivam dos eventos oficiais `onChunkDownloaded`/`onChunkUploaded` e dos contadores de payload HTTP, sem getters inexistentes no pacote 4. A interface arredonda para exibição; os contadores preservam bytes e proporção. Contagens descrevem payload recebido pelo motor, incluindo prefetch/retentativas; não incluem cabeçalhos IP/TLS nem equivalem a bytes efetivamente assistidos.

Web usa `P2PVideoPlayer.tsx` e `p2p/stats.ts`; Android recebe o mesmo snapshot da ponte. Reprodução nativa/HTTP consulta `/api/iptv/traffic/:grant`, com sessão proprietária obrigatória. Roku consulta esse endpoint a cada três segundos; quando há gateway ativo, a resposta identifica `scope=gateway-to-swarm`. Não são inventados peers ou economia quando não há WebRTC.

A prioridade P2P configura uma espera inicial de 1.200ms, janela de urgência de 2s, janela HTTP de 8s, prefetch P2P de 120s e um download HTTP simultâneo por Core. HTTP atende ausência de peers/segmentos ou prazos de reprodução. Manifests e metadados continuam sendo bootstrap HTTP. Esses parâmetros são uma política inicial de fallback, não uma garantia de economia de banda.

URLs de segmentos usam AES-SIV, com chave derivada por grant e autenticação. Assim permanecem estáveis nas atualizações de playlist e entre slots, sem reutilizar um nonce GCM com mensagens diferentes ou revelar senha na URL. Sessões e tokens de origem continuam usando AES-256-GCM com nonce aleatório. Testes verificam estabilidade, adulteração e isolamento por grant.

## 4. VOD e limites operacionais

Arquivos VOD são remuxados sob demanda em HLS MPEG-TS com `ffmpeg -c copy`. Não há reencodificação: codecs incompatíveis com um cliente continuam exigindo transcodificação externa. A playlist EVENT cresce durante a preparação e recebe ENDLIST ao concluir; seeks se limitam inicialmente à parte preparada. A origem pode ser consultada por Range pelo FFmpeg para arquivos MP4 com metadados no fim, via endpoint loopback que não é exposto pelo Nginx.

Limites por processo: quatro preparações VOD/cache ativos, até 2 GiB por preparação e expiração após 30min sem uso; quatro sessões de gateway (`P2P_RELAY_MAX_SESSIONS`), até quatro pedidos por sessão e 16 MiB por segmento na ponte. O gateway fecha sessões ociosas após 90s. O cache fica em volume próprio de cada slot e é limpo ao iniciar. Esses valores precisam ser dimensionados para a carga; o gateway Chromium tem custo maior que um peer no cliente.

Produção usa app com limite de 1.536 MiB e 2 CPUs, tmpfs de 256 MiB e volume VOD gravável, mantendo o restante do filesystem somente leitura. PostgreSQL/Redis e monitoramento estão em rede interna; apenas Nginx publica 80/443. Não há alta disponibilidade de banco/Redis no mesmo host. STUN está configurado; TURN próprio continua necessário em redes que exigem relay.

## 5. Pacotes, CI e implantação

```bash
npm ci
npm run build
npm run build:tv
apps/android/gradlew -p apps/android :app:assembleDebug :app:testDebugUnitTest
```

Saídas: `artifacts/highpass-roku.zip`, `artifacts/br.api.remoto.highpass_1.0.0_all.ipk` e APK debug. O WGT sem assinatura contém os arquivos de `apps/tizen`; para instalar/distribuir use Tizen Studio/Certificate Manager e `tizen package -t wgt -s PERFIL_CERTIFICADO -- apps/tizen`. Roku ZIP usa o instalador de desenvolvimento da TV; LG IPK usa `ares-install --device SUA_TV pacote.ipk` após habilitar Developer Mode. Assinaturas/contas de lojas e homologação física não são substituídas pelos testes de build.

O repositório é `https://github.com/dominikmarinho/p2p`. `deploy.yml` chama o workflow reutilizável `ci-cd.yml`: tipos/lint, pacotes TV, testes PG16/Redis7, HLS/P2P no navegador, APK/JVM, imagem GHCR e deploy SSH somente main. Actions usam SHA fixo. O script aplica migrations antes da troca, verifica readiness, muda blue/green com Nginx e drena o slot antigo. `HIGHPASS_LOCAL_IMAGE=1` permite ao operador um primeiro deploy de imagem já construída localmente; o caminho normal usa pull do GHCR.

Secrets: `HOST`, `USERNAME`, `PORT`, `SSH_PRIVATE_KEY`, `SSH_HOST_FINGERPRINT`, `GHCR_TOKEN`. O servidor usa chave SSH dedicada e sudo apenas para o helper de troca de upstream, além do acesso Docker necessário ao deploy. Consulte [produção](production.md) para rotação, backup, rollback e recuperação.
