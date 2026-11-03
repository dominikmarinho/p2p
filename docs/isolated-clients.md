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
