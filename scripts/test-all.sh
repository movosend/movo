#!/usr/bin/env bash
# Corre los tests de todos los paquetes del monorepo. Requiere Postgres/Redis
# corriendo localmente (ver infra/docker-compose.local.yml) para que los tests
# de integración de los servicios Node pasen.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE_PACKAGES=(
  "gateway"
  "services/movo-svc-users"
  "services/movo-svc-shipments"
  "services/movo-svc-payments"
  "services/movo-svc-admin"
  "movo-mobile"
  "movo-admin"
)

for pkg in "${NODE_PACKAGES[@]}"; do
  echo "== $pkg =="
  (cd "$pkg" && npm ci && npm test)
done

echo "== services/movo-svc-pricing-logistics =="
(
  cd services/movo-svc-pricing-logistics
  pip install -r requirements.txt -r requirements-dev.txt
  pytest
)

echo "Todos los tests pasaron."
