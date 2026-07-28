#!/usr/bin/env bash
# Aplica, en orden, las migraciones .sql de <service_dir>/migrations contra $DATABASE_URL.
# Uso: DATABASE_URL=postgresql://... ./scripts/run-migrations.sh services/movo-svc-users
set -euo pipefail

SERVICE_DIR="${1:?Uso: run-migrations.sh <ruta-del-servicio>}"
MIGRATIONS_DIR="$SERVICE_DIR/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No existe $MIGRATIONS_DIR, nada que migrar."
  exit 0
fi

shopt -s nullglob
files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [ ${#files[@]} -eq 0 ]; then
  echo "No hay archivos .sql en $MIGRATIONS_DIR, nada que migrar."
  exit 0
fi

for file in $(printf '%s\n' "${files[@]}" | sort); do
  echo "Aplicando migración: $file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
done
