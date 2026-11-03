# Preparação de produção em Debian/Ubuntu

## Pré-requisitos do host

Use um host com Docker Engine e Compose atual, Nginx, Certbot, OpenSSH, curl, openssl, sudo e util-linux (`flock`). Instale Docker seguindo as instruções oficiais para [Debian](https://docs.docker.com/engine/install/debian/) ou [Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Valide `docker version` e `docker compose version`. Os exemplos abaixo assumem uma cópia do projeto na shell administrativa, usuário `deploy` e domínio real apontando para o host. Troque o domínio de exemplo pelo seu.

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot curl openssl sudo util-linux
sudo systemctl enable --now docker nginx
sudo adduser --disabled-password --gecos '' deploy
sudo usermod -aG docker deploy
sudo install -d -m 0750 -o deploy -g deploy /opt/highpass /opt/highpass/releases
```

Reabra a sessão de `deploy` depois de adicioná-lo ao grupo Docker. Controle acesso a esse usuário: o grupo Docker permite controle equivalente a root sobre o host. Abra somente SSH, 80 e 443 no firewall; PostgreSQL/Redis não publicam portas em produção e as portas de app ficam em loopback.

## Par de chaves SSH para o GitHub Actions

Gere a chave dedicada em uma máquina administrativa confiável. A chave privada será armazenada no GitHub e a pública no servidor:

```bash
ssh-keygen -t ed25519 -a 100 -C github-highpass-deploy -f ./highpass_deploy
sudo install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
sudo touch /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 0600 /home/deploy/.ssh/authorized_keys
```

Se executar estes comandos na máquina administrativa, transfira somente a chave `.pub` ao servidor por uma sessão SSH já confiável. Acrescente a chave pública ao `authorized_keys` do servidor com restrições:

```bash
printf 'restrict %s\n' "$(cat ./highpass_deploy.pub)" | sudo tee -a /home/deploy/.ssh/authorized_keys >/dev/null
```

`restrict` impede forwarding e PTY, mas permite o comando remoto usado pelo workflow. Use o conteúdo completo de `highpass_deploy` como `SSH_PRIVATE_KEY`, preservando quebras de linha. Se escolheu uma passphrase, adicione o secret `SSH_PASSPHRASE` e o input `passphrase: ${{ secrets.SSH_PASSPHRASE }}` ao passo `ssh-action`; o workflow padrão assume chave dedicada sem passphrase guardada como secret.

Obtenha a fingerprint **no console confiável do servidor**:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

Copie apenas `SHA256:...` para `SSH_HOST_FINGERPRINT`. Não obtenha confiança inicial apenas com `ssh-keyscan` em uma rede desconhecida. Teste acesso manual com a nova chave antes de ativar o workflow.

## GitHub Secrets e permissões do registry

No repositório, abra **Settings → Environments → New environment → production**. Em **Environment secrets**, adicione os valores:

| Secret | Conteúdo |
| --- | --- |
| `HOST` | IP ou DNS do servidor; sem protocolo |
| `USERNAME` | `deploy` |
| `SSH_PRIVATE_KEY` | Chave privada OpenSSH completa da automação |
| `PORT` | Porta SSH, normalmente `22` |
| `SSH_HOST_FINGERPRINT` | Fingerprint SHA256 obtida no console do host |
| `GHCR_TOKEN` | PAT classic com `read:packages` e acesso à imagem privada |

Também é possível usar **Settings → Secrets and variables → Actions → Repository secrets**. Os secrets de ambiente prevalecem quando o job usa `environment: production`. Restrinja o ambiente à branch `main`. Para deploy automático sem intervenção, não configure um reviewer obrigatório; mantenha proteção de branch e revisão de pull requests.

O build publica com `GITHUB_TOKEN`, que é fornecido automaticamente e recebe `packages: write` somente no job de publicação. O servidor usa `GHCR_TOKEN` com leitura: ele não precisa de `write:packages` nem `delete:packages`. Crie o PAT em **Settings da conta → Developer settings → Personal access tokens → Tokens (classic)**, selecione `read:packages`, defina expiração e autorize SSO se exigido pela organização. O dono do PAT precisa ter acesso ao pacote. Quando o dono do pacote é uma organização, configure a variável `GHCR_USERNAME` no repositório/ambiente com o login da conta que emitiu o token. Sem a variável, o workflow usa `github.repository_owner`.

O nome da imagem é normalizado para minúsculas. O primeiro push no GHCR é privado por padrão. Se já existe pacote criado fora desse repositório, conceda acesso ao workflow nas configurações do pacote. O login remoto usa `--password-stdin`, armazenamento temporário e remoção ao sair. Veja a [documentação oficial do GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Segredos da aplicação e infraestrutura

Crie o arquivo no servidor, fora dos diretórios de release. Os valores precisam ser compartilhados por blue e green para validar os mesmos JWTs e acessar os mesmos dados. O bloco gera segredos reais hexadecimais; não use os valores ilustrativos de `.env.production.example`.

```bash
sudo -u deploy bash <<'BASH'
set -euo pipefail
umask 077
PG_SECRET=$(openssl rand -hex 32)
REDIS_SECRET=$(openssl rand -hex 32)
AUTH_SECRET=$(openssl rand -hex 48)
ADMIN_SECRET=$(openssl rand -hex 32)
ENCRYPTION_SECRET=$(openssl rand -hex 32)
METRICS_SECRET=$(openssl rand -hex 32)
GRAFANA_SECRET=$(openssl rand -hex 32)
cat > /opt/highpass/.env <<EOF
POSTGRES_DB=highpass_db
POSTGRES_USER=highpass_user
POSTGRES_PASSWORD=$PG_SECRET
DATABASE_URL=postgresql://highpass_user:$PG_SECRET@postgres:5432/highpass_db
REDIS_PASSWORD=$REDIS_SECRET
JWT_SECRET=$AUTH_SECRET
APP_IMAGE=ghcr.io/dominikmarinho/p2p:latest
APP_PORT=3001
DB_POOL_MAX=10
ADMIN_INITIAL_PASSWORD=$ADMIN_SECRET
ADMIN_BOOTSTRAP_KEY=$ADMIN_SECRET
CONFIG_ENCRYPTION_KEY=$ENCRYPTION_SECRET
METRICS_TOKEN=$METRICS_SECRET
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=$GRAFANA_SECRET
XUI_ALLOWED_HOSTS=xuione.remoto.api.br
XUI_ALLOW_HTTP=true
XUI_BASE_URL=http://xuione.remoto.api.br
PUBLIC_ENGINE_URL=https://p2p.remoto.api.br
RTC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
EOF
BASH
```

Ajuste `APP_IMAGE` para seu pacote real e `XUI_ALLOWED_HOSTS` para os hosts/portas de origem e balanceadores autorizados. O guia [P2P e observabilidade](p2p-observability.md) descreve painel, monitoramento e novas variáveis. O deploy sobrescreve essa variável com a tag SHA. Execute a geração apenas na preparação inicial: recriar senhas depois que o volume PostgreSQL existe não troca as credenciais dentro do banco. Para senhas com caracteres reservados, faça percent-encoding apenas na senha contida em `DATABASE_URL`; `POSTGRES_PASSWORD` continua contendo o valor original. Não envie `.env` ao GitHub nem ao build.

Da cópia do projeto no servidor, usando o usuário `deploy`:

```bash
docker network create highpass-backend
docker volume create highpass_postgres_prod_data
docker volume create highpass_prometheus_data
docker volume create highpass_grafana_data
docker compose --env-file /opt/highpass/.env -p highpass-data \
  -f docker-compose.prod.yml up -d --wait postgres redis
```

A infraestrutura usa o projeto `highpass-data`; cada instância da aplicação usa `highpass-blue` ou `highpass-green`. Todos compartilham a rede externa `highpass-backend`. O runner do deploy usa `--no-deps` porque a infraestrutura já está provisionada. Não execute `up` sem selecionar serviços nesses projetos: isso poderia criar outro PostgreSQL/Redis na mesma rede. Não use `down -v` em produção.

## Nginx e SSL: ordem de ativação

Primeiro, instale os arquivos sem depender de um certificado ainda inexistente:

```bash
sudo install -d -m 0755 /etc/nginx/highpass
sudo install -m 0644 infra/nginx/highpass-http.conf /etc/nginx/conf.d/highpass.conf
sudo install -m 0644 infra/nginx/highpass-proxy.conf /etc/nginx/snippets/highpass-proxy.conf
printf 'upstream highpass_api { server 127.0.0.1:3001; keepalive 64; }\n' | \
  sudo tee /etc/nginx/highpass/upstream.conf >/dev/null
sudo install -o root -g root -m 0755 scripts/highpass-switch /usr/local/sbin/highpass-switch
printf 'deploy ALL=(root) NOPASSWD: /usr/local/sbin/highpass-switch 3001, /usr/local/sbin/highpass-switch 3002\n' | \
  sudo tee /etc/sudoers.d/highpass >/dev/null
sudo chmod 0440 /etc/sudoers.d/highpass
sudo visudo -cf /etc/sudoers.d/highpass
```

Adicione `worker_shutdown_timeout 30s;` no contexto principal de `/etc/nginx/nginx.conf`, fora do bloco `http`. A configuração limita a drenagem de workers antigos; o script espera 35s antes de parar o container anterior. `highpass-http.conf` já é incluído no bloco `http` pelo layout padrão Debian/Ubuntu. Ele declara os mapas, zonas de rate limit e o upstream, além do listener interno de readiness na porta 8080.

Em uma shell administrativa Bash, configure o domínio e gere inicialmente um site somente HTTP:

```bash
DOMAIN=p2p.remoto.api.br
sudo mkdir -p /var/www/html
cat <<EOF | sudo tee /etc/nginx/sites-available/highpass-api.conf >/dev/null
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 503; }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/highpass-api.conf /etc/nginx/sites-enabled/highpass-api.conf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/html -d "$DOMAIN"
```

O DNS A/AAAA precisa apontar para este servidor e a porta 80 precisa estar acessível. Informe seu e-mail e aceite os termos do Let's Encrypt no Certbot. Depois que o certificado existir, ative HTTPS:

```bash
sed "s/__DOMAIN__/$DOMAIN/g" infra/nginx/api.conf.template | \
  sudo tee /etc/nginx/sites-available/highpass-api.conf >/dev/null
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Crie o hook de reload para certificados renovados via webroot:

```bash
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\n/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx\n' | \
  sudo tee /etc/letsencrypt/renewal-hooks/deploy/highpass-nginx >/dev/null
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/highpass-nginx
sudo systemctl enable --now certbot.timer
```

O site usa `listen ... ssl http2`, compatível com Nginx dos pacotes Debian/Ubuntu; versões mais recentes podem recomendar `http2 on`. O HSTS cobre somente o domínio configurado, sem habilitar preload/includeSubDomains automaticamente. O proxy sobrescreve `X-Forwarded-For`, e o Fastify confia em exatamente um salto. Se adicionar CDN ou outro proxy, revise a cadeia de confiança e as chaves de rate limit.

## Primeiro deploy e próximas publicações

Após configurar secrets, infraestrutura e Nginx, um push aprovado em `main` executará lint, testes, build Android, publicação da imagem e deploy. O job envia Compose, scripts e configurações Prometheus/Grafana da mesma revisão para `/opt/highpass/releases/COMMIT_SHA`; não há `git pull` remoto nem necessidade de dar acesso do host ao código privado. O primeiro deploy seleciona blue/3001; o próximo seleciona green/3002. O helper root aceita somente essas portas e valida a configuração antes do reload.

Confira no servidor:

```bash
cat /opt/highpass/active-slot
docker ps --filter name=highpass
curl --fail http://127.0.0.1:8080/health/ready
curl --fail https://p2p.remoto.api.br/health/ready
```

Para rollback de código com schema compatível, publique um commit de reversão em `main` ou execute manualmente o script de um release com a imagem SHA anterior. Use o mesmo usuário `deploy`, faça login no GHCR e exporte `APP_IMAGE=ghcr.io/sua-org/seu-repo:SHA_COMPLETO` antes de `bash /opt/highpass/releases/SHA_COMPLETO/scripts/deploy.sh`. Migrations aplicadas não são desfeitas automaticamente. Sempre use expand/contract e teste rollback em homologação.

## Validar rate limiting

Nginx aplica 2 req/s com burst 5 em `/auth/` e `/api/iptv/login` e 30 req/s com burst 20 nas demais rotas. Fastify mantém ainda limites compartilhados no Redis: 100 req/min em geral e 10 req/min nas rotas de login/cadastro/refresh. O excesso retorna 429. Os limites são complementares; ajuste conforme NATs, usuários esperados e carga. Um estado ocupa 128 bytes em plataformas de 64 bits, portanto uma zona de 10 MiB não deve ser anunciada como capacidade fixa de 160 mil IPs. Veja o [módulo oficial do Nginx](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).

```bash
seq 1 20 | xargs -P 10 -I '{}' curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST https://p2p.remoto.api.br/auth/login \
  -H 'Content-Type: application/json' -d '{}'
```

As respostas permitidas serão 400 para o body inválido; as limitadas serão 429. Não se espera 200 para uma rota sem credenciais. Inspecione os logs se não houver 429, considerando a velocidade do cliente e a distribuição entre IPs.

## Alternativa de execução com PM2 no host

Docker já fornece restart e isolamento. Use PM2 somente se optar pela execução direta em Linux:

```bash
npm ci
npm run build
npm run db:migrate
npx pm2 start ecosystem.config.cjs --env production
npx pm2 reload ecosystem.config.cjs --env production --update-env
npx pm2 save
npx pm2 startup
```

Exporte `DATABASE_URL`, Redis e JWT antes dos comandos ou forneça um `.env` com modo 0600. Para execução no host, os endereços do banco/Redis devem ser acessíveis a partir do host, não os nomes da rede Docker. Se reutilizar o Nginx entregue, aponte `upstream.conf` para `127.0.0.1:3000`. Execute o comando administrativo indicado por `pm2 startup` para persistir o serviço. A configuração usa `wait_ready`, o servidor envia `ready` somente depois do listen e o `kill_timeout` excede o prazo de shutdown. Os dois workers compartilham rate limits e tickets Redis; sockets não compartilham estado em memória entre workers.

A coleta Prometheus entregue foi validada no modo Docker, com um processo por container. No PM2 cluster, cada worker mantém seu próprio registro: o endpoint compartilhado não agrega os workers. Para monitorar esse modo, é necessário um agregador de cluster ou endpoints individuais por processo; essa configuração adicional não está incluída.

## Operação e limites

Reserve capacidade para duas instâncias durante deploy; o limite inicial de cada container de app é 512 MiB e um CPU. Dimensione `DB_POOL_MAX × processos × instâncias`, conexões de manutenção e `max_connections` do PostgreSQL. Não há ajuste universal de `shared_buffers`/`work_mem` sem saber a RAM e a carga. O Redis de controle está limitado a 128 MiB; monitore erros OOM e latência antes de aumentar os limites. Os parâmetros são iniciais, não resultados de benchmark.

Faça backup externo e teste restauração do volume PostgreSQL. Limpe sessões com `DELETE FROM refresh_tokens WHERE expires_at < now()` em manutenção periódica; mantenha tokens revogados até a expiração para detectar replay. Monitore readiness, duração das queries, ocupação do pool, lag do Event Loop, heap e conexões WS. Atualizações de infraestrutura, rotação de credenciais e migrações destrutivas devem ter janela/estratégia próprias. Redis é efêmero; reiniciá-lo invalida tickets e zera contadores de rate limit. Logs são rotacionados pelo Docker.

Node 22 foi mantido conforme a especificação. A [agenda oficial](https://github.com/nodejs/Release) prevê fim de suporte em 30/04/2027; programe a migração de runtime antes dessa data. O lockfile fixa as dependências npm; atualizações das imagens base devem passar pelo pipeline. Tags SHA permitem selecionar o build publicado; para exigir imutabilidade também contra retagging no registry, evolua o deploy para usar o digest da imagem.
