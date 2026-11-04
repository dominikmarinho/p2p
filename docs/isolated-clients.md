# Clientes separados — 1.2.0

| Cliente | Endereço / APK | Transporte dos segmentos de vídeo |
|---|---|---|
| Web HTTP | `/player/http/` | HTTP, sem tracker nem seed |
| Web P2P | `/player/p2p/` | WebRTC, sem contingência HTTP |
| Android HTTP | `/downloads/android/highpass-latest.apk` | HTTP, sem WebView de transporte |
| Android P2P | `/downloads/android/p2p/highpass-latest.apk` | WebRTC, sem contingência HTTP |

`/player/` permite escolher explicitamente. Cada bundle fixa seu modo no build; preferências antigas não alteram o transporte. Catálogo, autenticação, playlists e chaves HLS continuam usando HTTPS. O seed recebe a origem XUI por HTTP/HTTPS. P2P exclusivo não significa eliminar essa alimentação da origem.

A API recebe `transport: http | p2p` na criação do playback. Grants P2P recusam segmentos HTTP e arquivos diretos antes de consultar a origem; somente o processo interno autenticado do seed pode baixá-los. Grants HTTP não criam seeds e não podem iniciar seed ou entrar no tracker. Grants antigos sem esse campo permanecem compatíveis com clientes já distribuídos.

Android HTTP mantém `com.highpass.player` e o certificado anterior, permitindo atualizar preservando login e favoritos. Android P2P usa `com.highpass.player.p2p`, instala ao lado do HTTP e exige login próprio. Ambos têm atualizações verificadas por pacote, tamanho, SHA-256 e assinatura. Os feeds são independentes.

O Android abre em tela cheia, respeitando a proporção do vídeo. O controle Menu/Voltar exibe canais e informações. Tráfego ocupa uma linha transparente no topo. Saída do player libera o lease; fechamento inesperado do WebSocket e expiração do heartbeat também encerram o seed sem espectadores.

## Build

```bash
npm ci
npm run build
apps/android/gradlew -p apps/android :app:assembleHttpRelease :app:assembleP2pRelease :app:testHttpDebugUnitTest :app:testP2pDebugUnitTest
```

Os APKs estão em `apps/android/app/build/outputs/apk/http/release/` e `p2p/release/`. CI gera código de versão crescente e publica cada feed separado.

`test:browser` inclui uma interface de compatibilidade somente durante os testes de clientes antigos; a imagem de produção sempre recompila a raiz como seletor e publica os dois bundles fixos.

## Disponibilidade

P2P exige navegador com MediaSource/WebRTC, rede compatível com ICE/TURN, origem e seed operacionais. Quando indisponível, este cliente aguarda/informa erro; não troca para HTTP. Use explicitamente o cliente HTTP se desejar transmissão convencional. Os wrappers Samsung/LG abrem o cliente HTTP; Roku mantém o gateway HTTP, pois não suporta WebRTC nativo.

## Estabilidade 1.2.1

Web e ponte Android compartilham o perfil WebRTC: mensagens de 16 KiB, timeout sem bytes de 10 segundos (anteriormente 2), ICE com mais tempo e janela de prefetch de 60 segundos. O Android P2P aguarda até 45 segundos no Core e 47 na ponte nativa, sem baixar o segmento por HTTP. O buffer Android P2P passa a 30–60 segundos, com 2,5 segundos para iniciar e 6 para retomar após interrupção. A interface Web mantém ao menos 45 segundos de buffer desejado e quatro segmentos de distância do ao vivo. Esses valores aumentam a tolerância à variação da rede; não garantem estabilidade se a velocidade ficar abaixo do bitrate do canal.

Mesmo canal e mesma variante devem compartilhar o swarm. A reprodução em dois aparelhos não sincroniza automaticamente o relógio do vídeo. Limites de conexões continuam sendo os definidos pelo XUI. O teste de regressão mantém Web e ponte Android na mesma conta, confirma dois peers e confirma entrega de segmentos sem HTTP.

TURN é verificado por transferência real via UDP, TCP e TLS, não apenas pela abertura da porta. O teste no servidor não substitui a validação no aparelho e na operadora 5G.
