# Highpass Play 1.1 — aplicativos e reprodução

## Interface

Android TV e Android móvel usam a mesma identidade azul-escuro/verde do WebPlayer, com navegação adaptada a controle remoto ou toque. A biblioteca inclui início com cards, canais, filmes, séries, favoritos, configurações e conta; capas, categorias, busca e paginação; temporadas e episódios; continuar assistindo; guia de programação quando fornecido pelo XUI. As credenciais continuam limitadas a usuário e senha.

O player exibe uma linha transparente no topo: transporte recente, HTTP/P2P acumulados, peers, taxas e volume recebido. O estado acompanha os bytes efetivamente recebidos, sem confundir uma janela de HTTP permitida com uma entrega HTTP. No Android, a linha permanece em tela cheia. Percentuais representam os segmentos recebidos durante aquela reprodução; sinalização e playlists não são contados como vídeo P2P.

Roku inclui menu lateral, cards e capas, guia ao vivo, favoritos e consulta de versão. O trecho gateway → Roku continua HTTP; as estatísticas identificam o transporte entre gateway e swarm. Tizen e webOS abrem a interface hospedada, que recebe o mesmo layout e a opção de recarregar sua versão.

## Início e recuperação

A API inicia o aquecimento assíncrono do seed ao autorizar a reprodução. A resposta não espera a inicialização do navegador do seed. Os clientes mantêm a prioridade P2P durante o aquecimento do seed. HTTP é liberado quando o seed declara indisponibilidade ou quando um segmento excede seu prazo de entrega. Um seed pronto e peers com o segmento permitem P2P; uma falha não exige reiniciar o player inteiro para abrir HTTP. Novas entregas P2P fecham a contingência e o cliente continua tentando após recuperação.

O primeiro espectador de um canal frio pode receber segmentos por HTTP enquanto o seed obtém dados da origem e estabelece WebRTC. Não é possível prometer P2P disponível antes de existir algum peer com os segmentos. O prazo e a capacidade estão em `P2P_SEGMENT_TIMEOUT_MS` e `P2P_SEED_MAX_STREAMS`; espectadores desconectados expiram e seeds sem espectadores podem ceder sua vaga.

## Atualização do Android

Download de produção: `https://p2p.remoto.api.br/downloads/android/highpass-latest.apk`.

A versão antiga sem atualizador precisa receber este APK uma vez pelo instalador do aparelho. A partir da versão 1.1, use **Configurações → Verificar atualizações** ou **Atualizar aplicativo** no início/login. O Android pode pedir autorização para instalar pelo Highpass Play e sempre apresenta sua própria confirmação. Gerenciamento corporativo ou políticas da TV podem bloquear instalações.

O aplicativo consulta `/downloads/android/latest.json`, baixa somente do mesmo domínio HTTPS, limita tamanho e valida SHA-256, identificador do pacote, versão e certificado de assinatura instalado antes de abrir o instalador. O cache privado é compartilhado por FileProvider com permissão temporária. A atualização mantém o identificador `com.highpass.player`, a assinatura original e as preferências existentes; não apague os dados nem desinstale para atualizar.

## Publicação

O CI compila uma variante release não depurável e restaura a identidade original a partir do Secret `ANDROID_KEYSTORE_B64`. A variável `ANDROID_SIGNING_CERT_SHA256` deve corresponder ao certificado dos aplicativos distribuídos. Preserve e faça backup privado da chave: trocar o certificado impede atualizar instalações existentes.

O CI atribui `versionCode = 10000 + GITHUB_RUN_NUMBER × 100 + GITHUB_RUN_ATTEMPT`, garantindo um número crescente inclusive em nova execução do pipeline. Para novas versões visíveis, incremente `versionName` em `apps/android/app/build.gradle.kts`. O valor local de `versionCode` serve aos testes de desenvolvimento. Não sobrescreva um `highpass-N.apk`: o publicador rejeita conteúdo diferente no mesmo número, redução de versão ou mudança de certificado. O job valida o APK, transfere o artefato por SSH com fingerprint verificado e publica os pacotes antes dos manifestos. Não há chave de assinatura na imagem Docker ou no APK.

Preparação inicial do host:

```bash
sudo install -d -m 755 -o deploy -g deploy /var/www/highpass-downloads
sudo install -d -m 750 -o deploy -g deploy /opt/highpass/client-staging
```

Use o bloco `/downloads/` do template Nginx. Os arquivos públicos ficam fora do diretório privado de credenciais `/opt/highpass`. A validação `nginx -t` deve passar antes de recarregar o serviço. O CI publica em `/var/www/highpass-downloads`, mantendo arquivos imutáveis por versão e um link para o APK atual.

WebPlayer, Tizen e webOS consultam `/player/version.json` em Configurações. A ação de atualizar recarrega a interface preservando o cookie de sessão e os favoritos. O usuário confirma a interrupção da reprodução. O Roku consulta `/downloads/clients.json` e informa a versão; instalação/atualização do pacote usa o mecanismo da plataforma. ZIP/WGT/IPK disponíveis em `/downloads/tv/` são pacotes de desenvolvimento: assinatura e publicação nas lojas continuam específicas de cada fabricante.

## Validação

Os testes automatizados usam conteúdo sintético, PostgreSQL/Redis isolados e navegadores reais: HLS, catálogo, autenticação, capas, estados HTTP/P2P, entrega P2P com HTTP bloqueado, interrupção/recuperação de seed e atualização da interface. A suíte do publicador verifica corrupção, publicação imutável, downgrade e certificado divergente. O Android inclui testes JVM e compilação release/lint, com exercícios de interface e instalação no emulador; isso não substitui validar o APK no aparelho físico do usuário.
