> Referência do módulo REST/JWT original. Para a entrega atual Web/Android e CI, siga [README](../README.md) e [ecossistema](ecosystem.md). O deploy vigente está em [produção](production.md).

# highpass-p2p-engine

Engine de validação XUI ONE e sinalização P2P, painel administrativo web, API REST/WebSocket e observabilidade Prometheus/Grafana. Node.js 22, TypeScript, Fastify, PostgreSQL 16, Drizzle e Redis 7. Evolução do projeto existente `highpass-microservice`, com migrations incrementais versionadas.

O guia completo dos novos módulos, fluxo P2P, acesso ao painel, segurança e monitoramento está em [docs/p2p-observability.md](p2p-observability.md). Localmente: painel em **http://127.0.0.1:3000/admin**, Grafana em **http://127.0.0.1:3003** e Prometheus em **http://127.0.0.1:9090**. As credenciais de desenvolvimento estão em `.env.example`.

![Painel administrativo](admin-preview.png)

## 1. Visão geral da arquitetura

Arquitetura modular com separação simples de responsabilidades. Cada módulo mantém suas rotas, DTOs, controller, serviço e repositório. Os serviços recebem dependências por construtor, sem container de injeção ou abstrações genéricas de persistência. Isso mantém a tipagem das consultas Drizzle e o ciclo de vida do Fastify visíveis.

```text
Cliente REST / WebSocket
        │ TLS, limites por IP, proxy confiável
        ▼
      Nginx ────────────── blue:3001 / green:3002
        │
        ▼
Routes + DTO Zod → Controllers → Services → Repositories → PostgreSQL 16
        │                           │                         (Drizzle + pg.Pool)
        │                           └───────────────→ Redis 7
        │                                              rate limits / tickets / peers / sinalização entre instâncias
        └→ WebSocket: autenticação, heartbeat, limites de mensagem, backpressure

Container migration-runner → advisory lock PostgreSQL → SQL versionado em drizzle/
```

Fastify faz o roteamento, os hooks e a validação Zod antes da lógica de negócio. Drizzle usa o pool de `pg` diretamente, sem um engine externo. Não existe garantia literal de overhead zero: construir SQL, serializar JSON e validar entradas têm custo. RAM, latência e throughput precisam ser medidos com a carga real; este projeto fornece limites explícitos e uma base para esses testes.

As operações de rede e o hash scrypt são assíncronos. O scrypt executa no pool do libuv e há no máximo quatro hashes concorrentes por processo. PostgreSQL tem pool de dez conexões por processo e timeouts de conexão e consultas. O CRUD tem paginação por cursor e índice composto; não há listas sem limite. Redis tem limite de memória e `noeviction`, pois descartar arbitrariamente contadores e tickets enfraqueceria os controles. A aplicação falha de forma fechada se Redis estiver indisponível.

A implantação Docker mantém um processo Node por container. A alternativa PM2 usa dois workers no host e não é executada dentro do container. Durante uma troca blue/green, dimensione o banco para ambos os pools simultâneos. Um servidor de banco e um Redis continuam sendo pontos únicos de falha: alta disponibilidade exige réplicas/serviços gerenciados e mais de um host.

## 2. Árvore completa de diretórios

A árvore exata dos arquivos entregues está em [docs/file-tree.md](file-tree.md). `node_modules/`, `dist/` e `.env` são saídas locais e não fazem parte da distribuição.

## 3. Boilerplate executável

| Responsabilidade | Arquivos |
| --- | --- |
| Entrada e sinais SIGINT/SIGTERM; erros fatais encerram o processo | `src/server.ts` |
| Instância Fastify, plugins, erros HTTP e lifecycle das dependências | `src/app.ts` |
| Variáveis validadas sem imprimir valores secretos | `src/config/env.ts` |
| Pool pg, instância Drizzle, schema e migrator independente | `src/db/index.ts`, `schema.ts`, `migrate.ts` |
| Redis com reconexão limitada por comando e sem fila offline | `src/lib/redis.ts` |
| Cadastro/login, JWT, rotação e revogação de refresh tokens | `src/modules/auth/` |
| CRUD com isolamento por usuário e DTO Zod | `src/modules/notes/` |
| Liveness e readiness consultando PostgreSQL e Redis | `src/modules/health/` |
| WS com ticket de uso único, heartbeat e expiração da sessão | `src/modules/realtime/` |
| Build em múltiplos estágios, usuário sem privilégios e healthcheck nativo Node | `Dockerfile` |

O exemplo completo de fluxo é `POST /notes`: `notes.routes.ts` valida `createNoteDto`, `NotesController` recebe a entrada tipada, `NotesService` executa o caso de uso e `NotesRepository` chama `db.insert(notes).values(...).returning()`. Busca, edição e remoção sempre filtram por `ownerId` derivado do JWT; o body não aceita trocar o proprietário.

| Método | Endpoint | Autenticação / comportamento |
| --- | --- | --- |
| GET | `/health` | Liveness, sem dependências |
| GET | `/health/ready` | 200 com banco/Redis prontos; 503 em falha |
| POST | `/auth/register` | `{ "email": "user@example.com", "password": "a-long-secure-password" }` |
| POST | `/auth/login` | Mesmas credenciais; retorna accessToken e refreshToken |
| POST | `/auth/refresh` | `{ "refreshToken": "..." }`; rotaciona o token |
| POST | `/auth/logout` | Bearer + refreshToken; revoga a família |
| POST | `/auth/ws-ticket` | Bearer; gera ticket de uso único válido por 30s |
| GET | `/notes?limit=20&cursor=UUID` | Bearer; paginação por UUID crescente |
| POST | `/notes` | Bearer + `{ "title": "Título", "content": "Texto" }` |
| GET/PATCH/DELETE | `/notes/:id` | Bearer; somente proprietário |
| GET (upgrade) | `/ws?ticket=...` | Ticket de uso único; cliente nativo também pode usar Bearer |

O WebSocket aceita `{"type":"ping"}` e `{"type":"echo","message":"Olá"}`. Limites: 8 KiB por mensagem, 20 mensagens/s por conexão, 1.000 conexões por processo e 1 MiB de buffer de saída. O JWT expira mesmo com o socket aberto. O ticket evita transportar o JWT na URL; os logs fornecidos omitem a query string. Em um navegador, obtenha o ticket via `fetch` autenticado e conecte com `new WebSocket('wss://seu-dominio/ws?ticket=' + ticket)`.

Refresh tokens são valores opacos aleatórios de 48 bytes; apenas SHA-256 é persistido no banco. A rotação usa transação, bloqueio por família e bloqueio de linha. Reutilizar um token revoga toda a família, inclusive em requisições concorrentes. O cliente deve serializar refreshes. O prazo absoluto da família é de 30 dias, sem extensão a cada refresh. Logout não invalida um JWT de acesso já emitido: ele expira em até 15 minutos. Aplicações que exigem revogação imediata devem consultar sessão ou blacklist em cada requisição.

Redis armazena estado efêmero de controle, presença P2P e cache de validação XUI; a configuração entregue não mantém AOF/RDB. Ele pode hospedar uma fila em memória, mas não há processamento de jobs de negócio neste boilerplate. Jobs que precisem sobreviver a reinícios exigem persistência, confirmação e retentativas próprias (por exemplo, Streams ou um broker dedicado). O CRUD consulta PostgreSQL diretamente para evitar inconsistências de invalidação de cache.

Em shutdown, Fastify drena HTTP antes de fechar os pools. WebSockets recebem código 1012 e têm três segundos para concluir o fechamento. Há prazo global de vinte segundos; exceções não tratadas e rejeições não tratadas são registradas e encerram o processo com código de falha. Docker/PM2 faz a recuperação.

## 4. Pipeline de CI/CD e deploy SSH

O arquivo completo é [.github/workflows/ci-cd.yml](../.github/workflows/ci-cd.yml):

1. **Lint e tipos:** `npm ci`, `npx tsc --noEmit`, ESLint sem warnings.
2. **Testes:** PostgreSQL 16 e Redis 7 via `services`; testes unitários, migrations duas vezes para verificar idempotência, integração real e build TypeScript.
3. **Imagem:** build Docker em PRs; publicação em `main` no GHCR, tags SHA completo do commit e `latest`, com cache, SBOM e proveniência.
4. **Deploy:** somente `main`, após todos os jobs; `appleboy/ssh-action`, verificação da fingerprint do host, chave privada, login temporário no GHCR e envio dos arquivos de deploy da mesma revisão.

`scripts/deploy.sh` executa `docker compose -f docker-compose.prod.yml pull` para app/migrator, roda migrations antes da nova instância e usa `up -d --remove-orphans --no-deps --wait app` no slot inativo. Os parâmetros adicionais escolhem projeto e arquivo de ambiente. Após readiness, troca o upstream com `nginx -t` e reload, confirma a porta atendida pelo Nginx, drena a instância anterior e executa `docker image prune -f`. Falhas antes da troca preservam o serviço anterior; falhas na confirmação tentam reverter o upstream. Volumes de dados não são removidos. A limpeza padrão remove somente imagens sem tag; retenção de imagens SHA antigas deve ser tratada separadamente.

Um simples `compose up` recria o container existente quando a imagem muda; isso não garante continuidade. A estratégia entregue evita a janela de troca de HTTP quando o host tem capacidade para duas instâncias, os serviços de dados estão saudáveis e as migrations são compatíveis com ambas as versões. Use migrations **expand/contract**. DDL destrutivo, falhas de host e indisponibilidade do banco exigem estratégia operacional própria. WebSockets precisam reconectar ao final da drenagem; não é possível transferir uma conexão TCP estabelecida entre processos.

As configurações de Nginx/root helper são instaladas na preparação do servidor e não são substituídas automaticamente pelo deploy de aplicação. Alterações nesses arquivos exigem revisão e atualização explícita no host.

## 5. Setup e validação

### Ambiente local via Docker

Requisitos: Docker Engine com Compose v2.24+ (ou versão posterior compatível) e Node.js 22 para desenvolvimento fora do container. O exemplo local usa senhas de desenvolvimento; se as alterar, use caracteres hexadecimais ou faça percent-encoding na URI do PostgreSQL.

```bash
cd highpass-microservice
cp .env.example .env
npm ci
npx drizzle-kit generate
docker compose up -d --build --wait
docker compose ps -a
docker compose logs migration-runner
curl --fail http://127.0.0.1:3000/health/ready
```

O SQL inicial e o journal já estão incluídos; sem alteração de schema, `generate` informa que não há mudanças. Para evoluir o banco, edite `src/db/schema.ts`, execute `npx drizzle-kit generate --name nome_da_alteracao`, revise o SQL e versione **todo** o diretório `drizzle/`, incluindo `meta/`. Não use `drizzle-kit push` em produção. A geração não aplica SQL no banco. O migrator usa `drizzle-orm/node-postgres/migrator` e sua conexão só precisa de `DATABASE_URL`.

Para reaplicar as migrations em um ambiente local já iniciado, rode um runner novo. Execute este fluxo após toda mudança de schema para não depender do reaproveitamento de um container one-shot já concluído:

```bash
docker compose build
docker compose up -d --wait postgres redis
docker compose run --rm --no-deps migration-runner
docker compose up -d --wait app
```

### Desenvolvimento com Node no host

```bash
docker compose up -d --wait postgres redis
npm run db:migrate
npm run dev
```

`npm run dev` carrega `.env` pelo Node. O build de produção é `npm run build` e a execução é `npm start`; as variáveis precisam estar disponíveis em `.env` ou no ambiente. O Docker Compose substitui os hosts locais por `postgres`/`redis` para os containers.

### Validar REST e WebSocket

```bash
curl -i -X POST http://127.0.0.1:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"a-long-secure-password"}'
curl -sS -X POST http://127.0.0.1:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"a-long-secure-password"}'
read -r -s -p 'Cole o accessToken: ' ACCESS_TOKEN
export ACCESS_TOKEN
curl -i -X POST http://127.0.0.1:3000/notes \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Primeira nota","content":"API funcionando"}'
curl --fail http://127.0.0.1:3000/notes -H "Authorization: Bearer $ACCESS_TOKEN"
```

O teste de integração abre um WebSocket real, envia ping JSON e valida a resposta. Para teste manual com cliente nativo: `npx wscat -c ws://127.0.0.1:3000/ws -H "Authorization: Bearer $ACCESS_TOKEN"`.

### Testes com serviços isolados

Use um banco de teste próprio. Os testes criam usuários/notas e não devem apontar para produção. Em uma shell nova com os serviços locais ativos:

```bash
export NODE_ENV=test
export DATABASE_URL=postgresql://highpass_user:local_postgres_only@127.0.0.1:5432/highpass_db
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=local_redis_only
export JWT_SECRET=ci-only-secret-at-least-thirty-two-characters
npm run db:migrate
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

O exemplo usa o banco local descartável; para separar também os dados de desenvolvimento, crie `highpass_test` e ajuste `DATABASE_URL`. Os testes não são pulados se faltarem as dependências: falham com erro claro. Cada execução usa um namespace Redis próprio para os contadores de teste, com expiração automática.

### Produção, SSL e GitHub Secrets

Siga [docs/production.md](production.md) para preparar Debian/Ubuntu, criar o usuário/chaves SSH, configurar `HOST`, `USERNAME`, `SSH_PRIVATE_KEY`, `PORT`, `GHCR_TOKEN` e `SSH_HOST_FINGERPRINT`, emitir o certificado antes de ativar HTTPS, provisionar os dados e realizar o primeiro deploy. O guia também cobre PM2, rate limiting, rollback e dimensionamento.

Os resultados dos testes executados nesta entrega estão em [docs/validation.md](validation.md), incluindo o ensaio blue/green e a preservação da instância anterior quando uma migration falha.

ESLint 9 usa `eslint.config.js`. `.eslintrc` contém a configuração legada equivalente solicitada e não é carregado pelo comando de lint atual.

Referências: [lifecycle do Fastify](https://fastify.dev/docs/latest/Reference/Server/), [migrations Drizzle](https://orm.drizzle.team/docs/migrations), [Compose up](https://docs.docker.com/reference/cli/docker/compose/up/), [GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [SSH action](https://github.com/appleboy/ssh-action), [limites Nginx](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).
