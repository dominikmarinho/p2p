# Highpass para iPhone e iPad

Dois targets independentes, HTTP e P2P, em SwiftUI + WKWebView, com bundle IDs separados e a mesma interface dos WebPlayers. A engine HTTPS é fixa no build. O cliente P2P utiliza hls.js/ManagedMediaSource e WebRTC do WebKit; não adiciona HTTP de vídeo como fallback. HTTP não cria WebRTC. Mínimo nativo: iOS/iPadOS 17.1.

## Instalação disponível sem Apple Developer

A página https://p2p.remoto.api.br/player/ contém as opções **Instalar iPhone/iPad HTTP · Safari** e **Instalar iPhone/iPad P2P · Safari**. Abra no Safari, use Compartilhar → Adicionar à Tela de Início, ative Abrir como App quando disponível e adicione. Os manifests têm IDs e ícones separados. Isso instala aplicativos web, não IPAs. Não há reprodução offline de conteúdo.

## Build nativo no Mac

Instale Xcode e XcodeGen (`brew install xcodegen`), execute `xcodegen generate` nesta pasta e abra `Highpass.xcodeproj`. Os schemes são `HighpassHTTP` e `HighpassP2P`. Para instalar em aparelhos de desenvolvimento pelo Xcode, selecione sua equipe de assinatura e ajuste os identificadores de bundle se necessário. Uma conta Apple pessoal no Xcode oferece desenvolvimento com limitações; isso não habilita distribuição pública pelo site.

A esteira compila os dois targets para simulador e para dispositivo, sem assinatura, e executa testes de política de navegação e disponibilidade das APIs WebKit no simulador. O artefato sem assinatura é exclusivamente de desenvolvimento e não é anunciado no site como instalável. Teste físico de reprodução ainda é necessário para confirmar codecs, comportamento de rede, bateria e suspensão em segundo plano do iOS.

## Distribuição nativa futura

Para distribuição pública, configurar Apple Developer, identificadores dos dois aplicativos, certificados e perfis, App Store Connect e TestFlight. O site poderá então apontar para os dois links públicos de TestFlight; a primeira distribuição externa depende de análise da Apple. Ad Hoc exige aparelhos previamente cadastrados. Não expor certificados, perfis ou chaves no repositório ou nos downloads. A assinatura não deve ser simulada com IPA sem assinatura ou perfis de terceiros.

A interface usa WebKit e conteúdo remoto, portanto aprovação em loja não está garantida. As declarações de privacidade precisam refletir autenticação XUI, P2P e diagnóstico opcional antes de enviar para revisão. Os apps não pedem câmera/microfone, restringem a navegação ao cliente do transporte correspondente e oferecem recarga, indicação de rede e acesso às atualizações. Não mantêm compartilhamento de vídeo em segundo plano quando o iOS suspende o app.

Referências: [TestFlight](https://developer.apple.com/testflight/), [distribuição Ad Hoc](https://help.apple.com/xcode/mac/current/en.lproj/dev7ccaf4d3c.html), [Managed Media Source no iPhone](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/).
