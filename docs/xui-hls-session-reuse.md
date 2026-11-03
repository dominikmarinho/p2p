# Correção 1.1.1 — sessão HLS, seed e painel

A origem XUI desta instalação responde à entrada `/live/…/id.m3u8` com um redirect para uma URL opaca que identifica a sessão HLS. Abrir repetidamente a entrada cria novas sessões no XUI. Recarregar a URL resolvida mantém a sessão existente. Esse comportamento foi confirmado na origem real, sem registrar senhas, chaves ou tokens nos relatórios.

A engine passa a manter a URL resolvida por conta/conteúdo e a reutilizar os cookies da origem quando houver. O seed e o HTTP de contingência compartilham a busca dos mesmos segmentos, com cache limitado a 64 MiB por processo, 16 MiB por recurso e limites de concorrência/contextos. Pedidos Range e arquivos maiores continuam em streaming. Tokens expirados reabrem a entrada uma vez, compartilhando essa renovação entre pedidos concorrentes. Cada recurso continua exigindo sessão e autorização do catálogo.

Uma sessão HLS recebe várias playlists e segmentos durante a reprodução. Esses pedidos normais não devem criar uma entrada nova por segundo na tabela Live Connections do XUI. Durante a troca entre duas instâncias ou uma contingência pode haver duas sessões. Os contextos em memória da engine e as conexões ativas exibidas pelo XUI são medidas diferentes.

O seed não solicita novamente os segmentos que já conserva em cache. A coleta da playlist acompanha seu TARGETDURATION, mantém variantes/áudio autorizados e interrompe a coleta quando não há espectadores. Pronto significa que há mídia recente disponível, sem renovar artificialmente esse estado ao ler a mesma cauda antiga. Enquanto aquece, o player prioriza P2P; HTTP é liberado se o seed estiver indisponível ou se um segmento não chegar dentro do prazo. Novas entregas P2P fecham a contingência.

O painel e o Grafana distinguem aberturas da entrada HLS, recargas de sessão, cache, buscas compartilhadas e pedidos pendentes. Não há URLs privadas nem credenciais nos rótulos de métricas. O dashboard não confunde contexto em cache com conexão TCP no XUI.

A tela Seeds de mídia descarta respostas antigas ao trocar rapidamente de página. A tabela genérica e o botão Adicionar não são renderizados nessa tela. Os assets administrativos usam versão por conteúdo e não são guardados em cache.

As credenciais administrativas continuam no arquivo privado `/opt/highpass/access.txt`, com atalho `/root/access.txt`. A credencial desse arquivo foi aceita pelo endpoint de login; nenhuma redefinição foi necessária. No servidor, consulte com:

```bash
sudo cat /opt/highpass/access.txt
```

Após publicar, recarregue o WebPlayer e o painel para receber os assets novos. No Android, encerre e abra novamente a reprodução para carregar a ponte atualizada; a versão distribuída também aparece em Configurações → Verificar atualizações. O APK conserva o identificador e o certificado existentes.

Validações incluem 80 recargas usando uma única abertura da entrada, busca simultânea do mesmo segmento por seed/contingência, expiração, isolamento entre contas, Range, limites de memória, cookies e redirects, prioridade P2P durante aquecimento, recuperação automática e concorrência de navegação no painel. A conferência em produção mede separadamente primeiro frame, transporte, pausas e conexões ativas do XUI durante reprodução prolongada.

## Encerramento incorporado na versão 1.2.0

Fechar ou navegar para fora do WebPlayer libera o lease por `pagehide`/`keepalive`; apenas ocultar uma aba que reproduz não encerra a transmissão. O retorno pelo cache de navegação retoma o heartbeat. Android envia uma requisição nativa autenticada antes de destruir a WebView; Roku libera o gateway ao voltar ou terminar o vídeo. O tracker agrega os sockets de vídeo/áudio e só considera o player desconectado após fechar seu último socket, com um pequeno intervalo para reconexão.

O último espectador faz o worker parar imediatamente; outros espectadores ativos continuam atendidos. Um processo que desaparece sem aviso perde seu lease após 15 segundos sem heartbeat. O gateway Roku sem atividade também é encerrado. Cancelar um seed ainda em inicialização fecha seu contexto para impedir que um navegador órfão volte a consultar a origem.

A ausência de novas requisições da engine e a remoção da linha no painel XUI são verificações diferentes: o XUI pode manter registros HLS até seu timeout interno. A engine não mata sessões de outras linhas nem altera a configuração de timeout do XUI. A sessão HLS resolvida permanece brevemente em cache para que voltar ao canal não reabra a autenticação desnecessariamente.

No Android, a reprodução abre em paisagem e modo imersivo, ocupa a janela inteira e preserva a proporção da imagem (`FIT`). Material 4:3 em tela 16:9 pode apresentar faixas laterais; esticar ou cortar a imagem não é aplicado. MENU/Voltar permite acessar canais e informações. A linha transparente de tráfego continua no topo.
