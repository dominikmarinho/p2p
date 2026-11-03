# Validação da versão Smart TV/VOD

Executada em 03/11/2026 com Node 22, PG16 e Redis7 isolados do ambiente de produção.

| Verificação | Resultado local |
| --- | --- |
| Tipos backend/Web e ESLint | Aprovados |
| Unitários | 8 testes aprovados, incluindo percentuais e URLs estáveis/autenticadas |
| Integração | 44 testes aprovados com PostgreSQL/Redis reais, incluindo Admin API XUI |
| Android | APK debug e 2 testes JVM aprovados |
| Live Web → ponte Android | Segmento real de 459.848 bytes, receptor HTTP bloqueado, SHA-256 idêntico |
| Busca VOD na ponte Android | Busca para 130s: segmento de 204.544 bytes recebido por P2P, HTTP do receptor bloqueado, SHA-256 idêntico |
| VOD Web → gateway Roku | 1.833.752 bytes P2P na execução registrada, peer real e percentuais somando 100% |
| Remux VOD | HLS reproduzido no navegador; saída de duas linhas com SHA-256 idêntico |
| Roku | BrightScript validado e ZIP gerado |
| LG webOS | IPK gerado pela CLI oficial |
| Samsung Tizen | Configuração/launcher e WGT sem assinatura gerados |
| Infra | Docker multi-stage, healthchecks e configs Nginx/Prometheus validados |
| SSL | Certificado público Let's Encrypt emitido para p2p.remoto.api.br |

Os números de bytes variam conforme o segmento selecionado em cada execução. O teste usa vídeo sintético e uma origem XUI controlada. Não representa benchmark de capacidade, autenticação com uma linha real ou homologação dos aparelhos físicos. Samsung requer assinatura própria; APK é debug; Roku e webOS exigem os modos de desenvolvimento/validação de loja adequados.

A correção de credenciais XUI acrescenta oito testes de integração: cifragem e ocultação de Access Code/API Key, consulta administrativa de leitura, preservação na edição, validação de paths, erros sem segredos, limites/redirects, separação da Player API e remoção explícita.

As suítes verificam JWT/refresh, isolamento do CRUD, sinalização entre instâncias, autenticação administrativa, troca de senha e revogação de sessões, linha inválida/expirada/desabilitada, catálogo/EPG/episódios, Range/206, permissões de mídia e tracker, percentuais e adulteração de recursos. O navegador exercita login com dois campos, reprodução, favoritos, séries, logout, viewport móvel e controle por teclas direcionais.

```bash
npm ci
npm run typecheck
npm run typecheck:web
npm run lint
npm test
npm run db:migrate
npm run test:integration
npx playwright install --with-deps chromium
npm run test:browser
npm run build:tv
apps/android/gradlew -p apps/android :app:assembleDebug :app:testDebugUnitTest
```

Para os testes exporte NODE_ENV=test, DATABASE_URL de um banco exclusivo chamado highpass_test, REDIS_HOST/PORT/PASSWORD e JWT_SECRET. Instale FFmpeg, JDK17 e SDK35 conforme os guias. CI reproduz esse fluxo com serviços isolados e publica os resultados no repositório. Os testes devem falhar se as dependências não estiverem prontas; não são pulados silenciosamente.

Os ensaios anteriores de troca blue/green verificaram continuidade HTTP e preservação do slot anterior quando migrations falham. Conexões WebSocket reconectam após a drenagem; não são transferidas entre processos. Migrations precisam ser compatíveis com ambos os slots. Banco e Redis continuam sendo serviços de um único host.

A ponte Android mantém os manifests recebidos enquanto a WebView inicializa, atualiza a posição do motor P2P ao buscar em VOD e libera as requisições pendentes antes de encerrar o ExoPlayer. O teste de busca usa o mesmo Core/ponte JavaScript no Chromium; a validação física de Android TV e smartphones permanece necessária.
