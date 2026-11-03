#!/usr/bin/env bash
set -Eeuo pipefail
export DOCKER_API_VERSION="${DOCKER_API_VERSION:-$(docker version --format '{{.Server.APIVersion}}')}"
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
# Configurações versionadas não contêm segredos e precisam ser lidas pelos UIDs dos containers.
find prometheus grafana -type d ! -perm -005 -exec chmod 755 {} +
find prometheus grafana -type f ! -perm -004 -exec chmod 644 {} +
for volume in highpass_prometheus_data highpass_grafana_data; do docker volume create "$volume" >/dev/null; done
docker compose --env-file /opt/highpass/.env -p highpass-monitoring -f docker-compose.prod.yml pull prometheus grafana node-exporter blackbox
docker compose --env-file /opt/highpass/.env -p highpass-monitoring -f docker-compose.prod.yml up -d --remove-orphans --wait --wait-timeout 120 prometheus grafana node-exporter blackbox
