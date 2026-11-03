#!/usr/bin/env bash
set -Eeuo pipefail
export DOCKER_API_VERSION="${DOCKER_API_VERSION:-$(docker version --format '{{.Server.APIVersion}}')}"
umask 077
: "${APP_IMAGE:?APP_IMAGE deve identificar o SHA publicado no GHCR}"
[[ "$APP_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+:[a-f0-9]{40}$ ]] || { echo 'Imagem inválida' >&2; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
exec 9>/opt/highpass/deploy.lock
flock -n 9 || { echo 'Outro deploy está em execução' >&2; exit 1; }
[[ -f /opt/highpass/.env ]] || { echo '/opt/highpass/.env ausente' >&2; exit 1; }
active=none
[[ ! -f /opt/highpass/active-slot ]] || active=$(cat /opt/highpass/active-slot)
case "$active" in
  blue) slot=green; APP_PORT=3002 ;;
  green|none) slot=blue; APP_PORT=3001 ;;
  *) echo 'Estado de deploy inválido' >&2; exit 1 ;;
esac
export APP_PORT
export APP_SLOT="$slot"
compose=(docker compose --env-file /opt/highpass/.env -p "highpass-$slot" -f docker-compose.prod.yml)
switched=false
rollback() {
  code=$?
  trap - ERR
  if [[ "$switched" == true ]]; then
    if [[ "$active" == blue ]]; then old_port=3001; else old_port=3002; fi
    if [[ "$active" != none ]]; then
      if ! sudo -n /usr/local/sbin/highpass-switch "$old_port"; then
        echo 'Falha crítica no rollback do Nginx; candidato mantido ativo' >&2
        exit "$code"
      fi
    else
      echo 'Primeiro deploy: candidato mantido para diagnóstico' >&2
      exit "$code"
    fi
  fi
  "${compose[@]}" stop app || true
  echo 'Deploy falhou; a instância anterior foi preservada' >&2
  exit "$code"
}
trap rollback ERR
# Infraestrutura é provisionada uma vez; deploy de aplicação não atualiza banco ou Redis.
docker network inspect highpass-backend >/dev/null
for volume in highpass_prometheus_data highpass_grafana_data; do docker volume create "$volume" >/dev/null; done
if [[ "${HIGHPASS_LOCAL_IMAGE:-0}" == 1 ]]; then
  docker image inspect "$APP_IMAGE" >/dev/null
else
  "${compose[@]}" pull app migration-runner
fi
"${compose[@]}" run --rm --no-deps migration-runner
# Contingência separada da instância que hospeda os seeds, com as mesmas sessões/grants.
P2P_SEED_ENABLED=false APP_PORT=3004 APP_SLOT=fallback docker compose --env-file /opt/highpass/.env -p highpass-fallback -f docker-compose.prod.yml up -d --remove-orphans --no-deps --wait --wait-timeout 90 app
"${compose[@]}" up -d --remove-orphans --no-deps --wait --wait-timeout 90 app
curl --fail --silent --show-error --max-time 8 "http://127.0.0.1:$APP_PORT/health/ready"
sudo -n /usr/local/sbin/highpass-switch "$APP_PORT"
switched=true
verified=false
for ((attempt=0; attempt<20; attempt++)); do
  headers=$(curl --fail --silent --show-error --max-time 8 -D - http://127.0.0.1:8080/health/ready) || headers=''
  upstream=$(awk 'tolower($1)=="x-highpass-upstream:" {gsub("\r", "", $2); print $2}' <<< "$headers")
  if [[ "$upstream" == "127.0.0.1:$APP_PORT" ]]; then verified=true; break; fi
  sleep 1
done
[[ "$verified" == true ]]
printf '%s\n' "$slot" > /opt/highpass/active-slot.tmp
mv /opt/highpass/active-slot.tmp /opt/highpass/active-slot
trap - ERR
# Nginx tem worker_shutdown_timeout=30s. HTTP em curso dispõe de até 35s para drenar.
if [[ "$active" != none ]]; then
  sleep 35
  docker compose --env-file /opt/highpass/.env -p "highpass-$active" -f docker-compose.prod.yml stop app
fi
bash scripts/observability.sh
docker image prune -f
echo "Deploy concluído: $APP_IMAGE no slot $slot"
