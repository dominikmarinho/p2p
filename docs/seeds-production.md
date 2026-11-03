# Seeds, recuperação e diagnóstico em produção

O seed é um peer de infraestrutura, independente de outro espectador. A engine mantém um seed por conteúdo ativo (canal, filme ou episódio), alimentado pela origem HTTP configurada. A ingestão HTTP da origem e os manifests/metadados continuam necessários. Não se promete 100% de P2P em redes sem WebRTC ou enquanto um segmento está indisponível.

```text
XUI → HTTP → seed Chromium/Core → WebRTC/DataChannels → Web/Android/Tizen/webOS
                                          └→ gateway → HTTP → Roku
Player → HTTP de contingência → engine/fallback → XUI ou cache HLS VOD
```

## Política e limites

- `P2P_DELIVERY_ENABLED=true` faz o cliente seguir a política do servidor, inclusive se uma preferência local antiga desativava P2P.
- `P2P_SEED_ENABLED=true` habilita os seeds. Máximo inicial: `P2P_SEED_MAX_STREAMS=4` por instância; cada worker tem cache de segmentos de 64 MiB, até 256 leases e 32 posições recentes. Aquece variantes/áudio com limites e rodízio de posições VOD.
- O lease é renovado a cada 5s, vence em 35s e mantém o seed aquecido por mais 90s de ociosidade. Seeds ociosos cedem capacidade a novos conteúdos. Não baixa o catálogo inteiro sem demanda.
- Segmentos começam com HTTP fechado. Sem entrega P2P em `P2P_SEGMENT_TIMEOUT_MS=3000`, HTTP é habilitado por 5s; novas tentativas P2P e a recuperação são automáticas. Capacidade esgotada ou browser/WebRTC indisponível também permitem contingência.
- A quota de conexões da linha continua valendo para os clientes. Somente workers internos autenticados por segredo e loopback recebem o papel de seed; headers fornecidos por um cliente externo não concedem essa exceção.
- VOD usa remux HLS compartilhado por conteúdo. Cada pedido continua verificando a sessão; URLs da playlist pertencem ao grant de quem solicitou. Até quatro caches VOD, 2 GiB por preparação e 30min sem uso. Codecs incompatíveis ainda exigem transcodificação externa.
- O arquivo original é contingência quando HLS não pode ser preparado. Web/Android/Roku sondam a recuperação e voltam ao HLS preservando a posição, quando a falha foi de rede/preparação. No Roku o aparelho recebe HTTP do gateway; P2P ocorre entre gateway e swarm.
- A produção tem um app HTTP separado em loopback 3004 (`P2P_SEED_ENABLED=false`) e upstream `backup` no Nginx. Compartilha sessões/grants Redis e banco. Isso cobre queda do processo principal no mesmo host; não fornece HA de host, PostgreSQL ou Redis.

## Compatibilidade XUI e latência

A origem HTTP configurada redirecionava streams para HTTPS com certificado autoassinado. `XUI_PRESERVE_HTTP=true` preserva o HTTP **somente** para redirects no mesmo hostname/default HTTPS port quando a origem foi explicitamente configurada com HTTP e `XUI_ALLOW_HTTP=true`. Não altera a verificação TLS global nem aceita outros hosts. Para migrar a origem a HTTPS, instale um certificado válido e configure a URL HTTPS.

O XUI também renova assinaturas para segmentos com a mesma sequência HLS. O gateway mantém um alias autenticado estável por grant/playlist/seq, atualiza seu destino cifrado no Redis e expira o mapeamento em 10min. Isso evita `media sequence mismatch`. O build aplica uma correção específica e verificável no adaptador P2P 4.0.0 para init segments e rejeições assíncronas durante refresh; a atualização da biblioteca exige revisar esse patch.

A latência geral HTTP inclui login, catálogo e consultas à origem. O dashboard separa API local, tempo até headers XUI, fases DNS/TLS/transferência nas sondas, event loop e recursos do host. O tempo até headers não mede a duração de um filme. Percentis com poucos pedidos e buckets largos são estimativas; não são um SLA de capacidade.

Benchmark local, sem consultar o XUI:

```bash
BENCHMARK_BASE=http://127.0.0.1:3001 node --env-file=/opt/highpass/.env scripts/benchmark-http.mjs
```

Ajuste a porta ao slot ativo. O teste usa 200 pedidos por rota e concorrência 4. Não desabilita limites para tráfego público nem faz carga contra a origem. Sem evidência de backlog/drops ou pressão de descritores, não se altera `sysctl` indiscriminadamente.

## TURN no host Linux

Após DNS/Let's Encrypt estarem prontos e com IPv4 público no host:

```bash
sudo bash scripts/setup-turn.sh 45.238.94.6
sudo systemctl status coturn
```

O script instala configuração autenticada, cria um segredo privado em `/opt/highpass/.env`, copia certificados com permissões restritas e instala renovação Certbot. Execute novamente para atualizar a configuração preservando o segredo. Configure no firewall externo TCP/UDP 3478, TCP 5349 e UDP 49160–49559, além de SSH/80/443. As URLs e o segredo são lidos pelo app no próximo deploy; não coloque o segredo no build do cliente ou GitHub.

TURN usa credenciais temporárias HMAC-SHA1 vinculadas à expiração da sessão, quotas de alocação/banda e bloqueio de destinos privados/loopback. Os testes verificam WebRTC real forçado por relay em UDP e TLS. Uma instalação atrás de NAT requer adaptar mapeamento externo/listening IP e portas; o script assume IPv4 público diretamente no host.

## Monitoramento

```bash
sudo bash scripts/setup-monitoring-host.sh
bash scripts/observability.sh
```

O timer systemd coleta stats Docker e contadores das interfaces físicas a cada 15s. O Node Exporter lê textfiles e recursos do host em volumes somente leitura; não recebe Docker socket. Blackbox Exporter mede disponibilidade, fases HTTP/TLS e validade de certificados. Exporters/Prometheus ficam na rede interna; Grafana é publicado por HTTPS em `/grafana/`.

No Control Plane, **Seeds de mídia** mostra leases, prontidão, ingestão HTTP e upload WebRTC real do worker; permite reiniciar um seed. **Monitoramento** mostra memória, pool pg, ping Redis, falhas XUI e telemetria dos players. Atualização de 5s; dados de processo/seed pertencem à instância atendendo a chamada.

Métricas adicionais: `p2p_seed_*`, `xui_upstream_header_duration_seconds`, `xui_upstream_errors_total`, `player_reported_*`, `highpass_container_*`, `highpass_host_network_*` e `probe_*`. Downloads/uploads reportados pelos clientes incluem prefetch e não são auditados para cobrança. Redis deduplica contadores cumulativos, limita quatro reporters por grant e expira presença em 30s. Não inclui credenciais, URLs ou IDs de usuário em labels Prometheus. Erros têm categorias limitadas.

CI executa tipos/lint, testes unitários/PG16/Redis7, quatro suítes Chromium com payload/SHA-256 e falhas controladas, APK/JVM, pacotes TV, build GHCR e deploy SSH. Após o deploy, o runner verifica HTTPS e TURN TLS publicamente. O helper root `highpass-switch` deve ser instalado pelo operador ao atualizar sua versão; o usuário deploy só pode chamar a troca entre 3001/3002.
