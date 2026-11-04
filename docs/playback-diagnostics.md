# Diagnóstico visual do WebPlayer — 1.3.2

Abaixo do vídeo, **Compartilhar diagnóstico e imagens** inicia uma sessão explícita de até dez minutos. O aviso mostra um código de correlação e o botão passa a **Parar compartilhamento**. Não captura a tela do computador, outras abas ou áudio: somente uma imagem JPEG reduzida do elemento de vídeo a cada cinco segundos. Quando o navegador impede a captura, os dados continuam disponíveis com o estado `blocked`.

O Control Plane, em **Monitoramento**, mostra a última imagem e os dados de posição, intervalos em buffer, latência, quadros descartados, velocidade, peers, bytes HTTP/P2P/upload e eventos recentes de reprodução. Essa visualização atualiza a cada cinco segundos. Não representa controle remoto do navegador nem vídeo contínuo.

Cada sessão pertence ao grant e ao usuário autenticado. A leitura exige autenticação administrativa, sem cache. O Redis guarda somente a última amostra, cifrada com AES-GCM e expiração de 60 segundos; não há gravação ou histórico de imagens. A sessão de envio expira após dez minutos. A parada apaga a amostra e bloqueia uploads que já estavam em trânsito. Ao sair da aba o cliente tenta encerrá-la com `keepalive`; se a rede cair ou a sessão de login tiver terminado, a amostra desaparece pelo TTL. Há limite global de 20 sessões, corpo de 80 KB e JPEG codificado com no máximo 64.000 caracteres.

O diagnóstico não envia senhas, tokens, URLs de segmentos ou conteúdo de outras aplicações. Eventos transmitem somente códigos permitidos. Esse recurso não altera o transporte do vídeo nem libera fallback HTTP no cliente P2P.

## Verificação

Os testes de integração cobrem ativação, propriedade de sessão, acesso administrativo, JPEG inválido/tamanho excedido, parada e rejeição de amostra atrasada. O teste de navegador reproduz conteúdo sintético, comprova ausência de captura antes do clique, recebe JPEG do vídeo decodificado e verifica limpeza ao parar e navegar para fora da aba.

## Dados de tráfego

WebPlayer e Android exibem tráfego fora do vídeo por padrão. No WebPlayer o seletor **Dados de tráfego** alterna **Dentro do vídeo / Fora do vídeo**. No Android, abra **Opções/Canais** no player e use **Dados: fora / Dados: no vídeo**. A preferência é salva no navegador ou aplicativo. O campo **Enviado** é o acumulado real de upload P2P daquele cliente, em unidades legíveis (KB, MB ou GB); **↑ /s** é a taxa do momento. Receber de um seed não implica enviar para outro espectador: upload zero pode ser legítimo mesmo com vários peers.

O envio confirmado mostra **Diagnóstico recebido**, horário e código. Falhas temporárias são tentadas novamente até três vezes; se um proxy recusar a imagem com HTTP 413, a sessão continua enviando somente os dados. O Nginx reserva limite de 80 KB apenas para `/api/iptv/diagnostics/`; as outras rotas mantêm seus limites.

O WebPlayer P2P reconecta automaticamente após um erro fatal com espera progressiva de 3 a 30 segundos, conservando os contadores e a posição em conteúdo sob demanda. Não habilita HTTP para vídeo. Ao perder todos os peers, o indicador passa a aguardar conexão, mesmo que o histórico tenha 100% dos bytes por P2P.
