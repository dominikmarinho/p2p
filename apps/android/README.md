# Highpass Play Android

Cliente Kotlin/Media3 para Android 8 ou posterior, celulares e Android TV. A tela de login pede somente usuário e senha. A engine de produção é `https://p2p.remoto.api.br`, definida no build.

A interface oferece início com cards e totais do catálogo, menu lateral em TV, navegação horizontal em celular, capas, categorias, busca, filmes, temporadas e episódios, favoritos locais por conta, continuar assistindo, guia e conta. O controle remoto usa D-pad; MENU ou toque longo alterna favoritos. Login e favoritos são preservados ao instalar uma atualização com o mesmo applicationId e certificado.

O player usa ExoPlayer nativo. Uma WebView sem vídeo executa o mesmo transporte WebRTC do WebPlayer, permitindo compartilhar segmentos entre os clientes. A política de entrega prioriza P2P e recupera HTTP quando o segmento não pode ser entregue a tempo. Manifests e chaves usam HTTP e não aguardam a inicialização WebRTC. Os dados reais de HTTP/P2P, peers, taxas e volume aparecem em uma linha transparente no topo do vídeo, inclusive em tela cheia. Em telas pequenas, a linha pode ser deslizada horizontalmente.

## Compilar

Requer JDK 17, Android SDK 35 e build-tools 35.0.0.

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=/opt/android-sdk
apps/android/gradlew -p apps/android :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest --no-daemon
```

A configuração release é não depurável. `ANDROID_SIGNING_STORE_FILE`, `ANDROID_SIGNING_STORE_PASSWORD`, `ANDROID_SIGNING_KEY_ALIAS` e `ANDROID_SIGNING_KEY_PASSWORD` permitem fornecer a identidade de assinatura. O ambiente de distribuição existente mantém a identidade dos APKs já instalados; ela não deve ser trocada ao atualizar esses aparelhos. Sem uma chave disponível, um fork gera release sem assinatura. Chaves privadas não pertencem ao repositório.

Para o emulador acessar uma engine de teste local:

```bash
apps/android/gradlew -p apps/android :app:assembleRelease -PengineUrl=http://10.0.2.2:18310 --no-daemon
```

`clientVersionCode` e `clientVersionName` podem ser fornecidos por propriedades Gradle. Toda versão publicada deve incrementar `versionCode`; o servidor preserva URLs imutáveis para cada código.

## Atualizações

Acesse **Configurações → Verificar atualizações**, **Atualizar aplicativo** no menu TV ou o botão de atualização no login. O aplicativo consulta `/downloads/android/latest.json`, baixa o APK pela mesma origem HTTPS e valida tamanho, SHA-256, applicationId, versão e certificado contra o aplicativo instalado. Somente então abre o instalador do Android. Se necessário, o sistema solicita a permissão de instalar aplicativos por esta origem. A confirmação final pertence ao Android.

A primeira instalação desta versão deve usar o APK publicado, pois o APK antigo não continha o atualizador. Depois, novas versões ficam disponíveis por essa opção. Atualizações pelo app preservam a sessão cifrada pelo Android Keystore e a biblioteca local.

Os testes JVM cobrem integridade de segmentos e regras de atualização. A fixture `tests/e2e/android-fixture.ts` fornece catálogo, capas e vídeo sintéticos para testes no emulador com banco e Redis de teste. Não use a fixture com serviços de produção.
