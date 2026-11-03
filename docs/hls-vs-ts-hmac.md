# HLS, MPEG-TS e HMAC no Highpass

A correção mantém HLS e reutiliza a sessão resolvida pelo XUI. No servidor observado, a entrada autenticada do canal responde 302 para uma URL opaca de sessão. Reabrir a entrada a cada atualização criava sessões adicionais; atualizar a URL resolvida conserva a mesma sessão. Seed e contingência HTTP compartilham as requisições simultâneas e os segmentos em cache limitado.

## Medições nesta instalação

Na validação de produção de 3 de novembro de 2026, uma reprodução HLS real de 120 segundos teve pico de **uma sessão no XUI**, **94,1% dos bytes de vídeo por P2P** e **nenhuma parada observada**. O primeiro frame levou 4.313 ms nessa execução. Esses valores descrevem a amostra, sem garantia de tempo para todos os canais ou redes.

Uma única leitura MPEG-TS limitada a cinco segundos também foi testada: HTTP 200, `video/mp2t`, primeiro byte em 194 ms e sincronização TS válida. A Admin API mostrou zero conexões antes, uma MPEG-TS durante e zero depois do cancelamento, inclusive nas amostras de mais 10 e 30 segundos. A leitura não mediu primeiro frame, remux ou reprodução P2P; primeiro byte não equivale a vídeo pronto.

| Caminho | Relação com a origem | Efeito nos clientes atuais |
| --- | --- | --- |
| HLS com sessão reutilizada | Vários pedidos de playlist/segmentos dentro da mesma sessão | Mantém os players e o compartilhamento de segmentos existentes |
| TS direto para cada aparelho | Uma transferência contínua para cada aparelho | Não substitui a integração P2P atual; pode aumentar conexões conforme o número de aparelhos |
| Uma ingestão TS na engine → HLS local | Uma transferência contínua por canal/ingestão; engine produz segmentos | Alternativa possível, mas precisa de remux, supervisão, limites, encerramento por espectadores e medição de startup |

O P2P Media Loader compartilha segmentos de HLS/MPEG-DASH por WebRTC e integra Hls.js/Shaka. Uma URL TS contínua, sozinha, não fornece essa integração. [Documentação do autor](https://github.com/Novage/p2p-media-loader).

O FFmpeg permite streamcopy, sem decodificar e reencodar, mas o muxer HLS corta na próxima keyframe após o tempo configurado. `hls_time=2` não garante o primeiro segmento em dois segundos: o GOP da origem pode prolongar a espera. A solução TS → HLS precisa de benchmark completo antes de substituir HLS em produção. [FFmpeg — streamcopy](https://ffmpeg.org/ffmpeg.html#Streamcopy), [FFmpeg — muxer HLS](https://ffmpeg.org/ffmpeg-formats.html#hls-2).

## Fechar o player

Devem ser medidos separadamente: fim dos heartbeats, desconexão do tracker, parada do seed, fim das novas requisições à origem e remoção do registro no painel XUI. Um registro administrativo pode persistir depois da última transferência; não se deve interpretar esse registro isoladamente como socket ativo. O encerramento de um espectador também precisa preservar o seed enquanto existirem outros espectadores do mesmo conteúdo.

## HMAC e XUI ONE 1.5.13

HMAC autentica a integridade de mensagens com segredo compartilhado; não estabelece WebRTC nem encerra uma sessão HTTP. [RFC 2104](https://www.rfc-editor.org/rfc/rfc2104).

A documentação atual em `xuiofficial.com` se identifica como **XUI 1.7** e descreve HMAC para assinar pedidos de reprodução. Sua Admin API é documentada separadamente com Access Code e parâmetro `api_key`. Essa documentação não comprova o formato de token nem todos os recursos da instalação **1.5.13**. [Versão do produto](https://xuiofficial.com/), [HMAC e Fingerprint](https://xuiofficial.com/docs/security/hmac-and-fingerprint), [Admin API](https://xuiofficial.com/docs/api-reference/admin-api).

A consulta somente de leitura `get_hmacs` nesta instalação respondeu HTTP 200 com array vazio. O resultado não distingue lista vazia, ação ignorada ou restrição de permissões. Nenhuma chave foi criada, exposta, ativada ou rotacionada. Não são presumidos formatos de XUI 1.7 ou XUI.live para a versão 1.5.13.

A escolha atual é conservar HLS com sessão reutilizada, medir entrega e encerramento, e reservar ingestão TS compartilhada como alternativa caso a origem não mantenha a sessão ou não atenda ao encerramento necessário. Integrar HMAC futuramente exige validar o protocolo efetivamente aceito pela instalação, com as chaves restritas à engine.
