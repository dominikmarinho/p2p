# Diagnóstico visual do WebPlayer — 1.3.4

Abaixo do vídeo, **Compartilhar diagnóstico e imagens** inicia uma sessão explícita de até dez minutos. O aviso mostra um código de correlação e o botão passa a **Parar compartilhamento**. Não captura a tela do computador, outras abas ou áudio: somente uma imagem JPEG reduzida do elemento de vídeo a cada cinco segundos. Quando o navegador impede a captura, os dados continuam disponíveis com o estado `blocked`.

O Control Plane, em **Monitoramento**, mostra a última imagem e os dados de posição, intervalos em buffer, latência, quadros descartados, velocidade, peers, bytes HTTP/P2P/upload e eventos recentes de reprodução. Essa visualização atualiza a cada cinco segundos. Não representa controle remoto do navegador nem vídeo contínuo.

Cada sessão pertence ao grant e ao usuário autenticado. A leitura exige autenticação administrativa, sem cache. O Redis guarda somente a última amostra, cifrada com AES-GCM e expiração de 60 segundos; não há gravação ou histórico de imagens. A sessão de envio expira após dez minutos. A parada apaga a amostra e bloqueia uploads que já estavam em trânsito. Ao sair da aba o cliente tenta encerrá-la com `keepalive`; se a rede cair ou a sessão de login tiver terminado, a amostra desaparece pelo TTL. Há limite global de 20 sessões, corpo de 80 KB e JPEG codificado com no máximo 64.000 caracteres.

O diagnóstico não envia senhas, tokens, URLs de segmentos ou conteúdo de outras aplicações. Eventos transmitem somente códigos permitidos. Esse recurso não altera o transporte do vídeo nem libera fallback HTTP no cliente P2P.

## Verificação

Os testes de integração cobrem ativação, propriedade de sessão, acesso administrativo, JPEG inválido/tamanho excedido, parada e rejeição de amostra atrasada. O teste de navegador reproduz conteúdo sintético, comprova ausência de captura antes do clique, recebe JPEG do vídeo decodificado e verifica limpeza ao parar e navegar para fora da aba.

## Dados de tráfego

WebPlayer e Android exibem tráfego fora do vídeo por padrão. No WebPlayer o seletor **Dados de tráfego** alterna **Dentro do vídeo / Fora do vídeo**. No Android, abra **Opções/Canais** no player e use **Dados: fora / Dados: no vídeo**. A preferência é salva no navegador ou aplicativo. O campo **Enviado** é o acumulado real de upload P2P daquele cliente, em unidades legíveis (KB, MB ou GB); **↑ /s** é a taxa do momento. Receber de um seed não implica enviar para outro espectador: upload zero pode ser legítimo mesmo com vários peers.

O envio confirmado mostra **Diagnóstico recebido**, horário e código. Falhas temporárias são tentadas novamente até três vezes; se um proxy recusar a imagem com HTTP 413, a sessão continua enviando somente os dados. O Nginx reserva limite de 80 KB apenas para `/api/iptv/diagnostics/`; as outras rotas mantêm seus limites.

Os WebPlayers HTTP/P2P e os APKs HTTP/P2P reconectam automaticamente após um erro fatal ou 35 segundos sem avanço do vídeo com espera progressiva de 3 a 30 segundos, conservando os contadores e a posição em conteúdo sob demanda. O cliente P2P não habilita HTTP para vídeo. Pausa manual, navegação e fim de VOD interrompem as tentativas; fim inesperado de transmissão ao vivo permite reconexão. Ao perder todos os peers, o indicador passa a aguardar conexão, mesmo que o histórico tenha 100% dos bytes por P2P.

## Medir desde o clique

No topo da biblioteca, **Compartilhar diagnóstico de abertura** ativa uma sessão de metadados antes de escolher o conteúdo. Aguarde **pronto: clique em um canal**, anote o código e então clique no canal. Essa sessão envia tempos e buffer, sem imagens; continua existindo durante a autorização e em falhas anteriores à criação do player. Trocar o canal inicia outra tentativa e substitui a anterior, mantendo o código da sessão.

O Control Plane, em Monitoramento, mostra tempos cumulativos desde o clique: resposta da autorização, criação do player, playlist, confirmação de seed pronto, conexão do primeiro peer, primeiros dados, primeiro segmento e primeiro frame apresentado. `requestVideoFrameCallback` mede o frame apresentado; onde indisponível, o evento `playing` é identificado como aproximação. Fases paralelas podem chegar em ordem diferente; a confirmação de seed é observada por polling. Tempos não disponíveis permanecem ausentes.

A autorização mede a chamada da API de playback inteira, não separa DNS/TLS, consulta XUI e processamento interno. O envio ocorre a cada cinco segundos, mas os marcos usam o relógio monotônico local no instante do evento. O usuário pode compartilhar o diagnóstico visual existente em separado, caso queira enviar imagens depois que o player aparecer. Parada, encerramento da página, TTL de 60 segundos e limite de dez minutos seguem o mesmo mecanismo de privacidade.

## Correção de abertura ao vivo — 1.3.4

Antes do primeiro frame, se o playhead estiver em um intervalo vazio e houver ao menos três segundos já em buffer à frente, o WebPlayer alinha uma única vez ao começo desse trecho. Uma busca interna inicial pendente não bloqueia o alinhamento; toque ou teclado no vídeo suspendem esse ajuste por cinco segundos. A checagem é feita a cada 250 ms e não se aplica a VOD, pausa manual, interação recente nos controles do vídeo ou vídeo que já exibiu o primeiro frame. O diagnóstico registra `startupAligned`, quando aplicado. Não habilita HTTP no cliente P2P.

Quando um espectador ao vivo ainda está na posição zero, o seed prioriza a janela de abertura correspondente ao HOLD-BACK de quatro segmentos antes de completar o restante da janela. A carga na origem continua sequencial e mantém cache e deduplicação. O benefício real depende da disponibilidade da origem, conectividade WebRTC e conteúdo recebido.
