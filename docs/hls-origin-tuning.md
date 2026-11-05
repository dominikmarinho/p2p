# Avaliação de segmentos menores na origem XUI

O player não consegue transformar uma playlist com segmentos de dez segundos em segmentos de dois segundos apenas alterando um parâmetro local. É necessário mudar a geração HLS na origem, ou criar uma etapa de reempacotamento/transcodificação. Este documento descreve uma avaliação; a entrega 1.3.7 não modifica a origem XUI.

1. Escolher um canal de teste, mantendo o canal atual disponível como comparação.
2. Medir o `EXTINF`, tamanho dos segmentos e distância entre keyframes. A API Admin disponível e as opções efetivas da instalação XUI precisam ser verificadas; não há um caminho de menu ou parâmetro presumido neste projeto.
3. Testar primeiro segmentos de quatro segundos, com GOP/keyframes compatíveis. Em cópia de codecs, a divisão só consegue ocorrer nos keyframes existentes. Pedir `hls_time=4` não garante quatro segundos se o próximo keyframe só chega depois.
4. Se a fonte já fornecer keyframes adequados, reempacotar com cópia de vídeo/áudio pode bastar. Caso contrário, inserir keyframes exige transcodificar o vídeo, com custo de CPU/GPU e possível alteração de qualidade. Não usar cortes arbitrários entre quadros para aparentar segmentos menores.
5. Comparar tempo de abertura p50/p95, pausas, bitrate, CPU, banda, número de pedidos e sessões XUI. Testar WebPlayer e Android em redes diferentes; manter todos os peers no mesmo canal/variante e segmentos equivalentes. Só então expandir gradualmente.

Exemplo de parâmetros para um encoder H.264 a 30 fps, em um canal de teste com GOP fixo de quatro segundos: `-g 120 -keyint_min 120 -sc_threshold 0 -force_key_frames 'expr:gte(t,n_forced*4)' -f hls -hls_time 4`. Isso é um exemplo de encoder, não um comando para aplicar diretamente no painel XUI; bitrate, áudio, hardware e limites precisam acompanhar o perfil da origem. O uso de `independent_segments` só é correto se cada segmento realmente começar em keyframe.

Segmentos menores aumentam o número de pedidos. Reduzir o atraso do ao vivo também exige rever o HOLD-BACK: quatro segmentos de quatro segundos representam dezesseis segundos, mas a estabilidade em 5G deve ser medida antes de adotar esse atraso. O projeto mantém a política atual até uma avaliação controlada.

Referência primária: [FFmpeg — HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-1).
