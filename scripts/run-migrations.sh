#!/usr/bin/env bash
# Aplica, en orden y una sola vez cada una, las migraciones .sql de
# <service_dir>/migrations contra $DATABASE_URL. Lleva registro de lo ya
# aplicado en public.schema_migrations (compartida entre servicios: una sola
# instancia de Postgres, ver ADR-003) para no reaplicar migraciones ya
# corridas en un deploy anterior -- este script corre en cada deploy contra
# la base real de dev/prod, no solo contra el Postgres efímero del CI.
# Uso: DATABASE_URL=postgresql://... ./scripts/run-migrations.sh services/movo-svc-users
set -euo pipefail

SERVICE_DIR="${1:?Uso: run-migrations.sh <ruta-del-servicio>}"
SERVICE_NAME="$(basename "$SERVICE_DIR")"
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

if command -v psql &> /dev/null; then
  PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
else
  CONTAINER_NAME="$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -n 1)"
  if [ -z "$CONTAINER_NAME" ]; then
    echo "Error: psql no está instalado y no hay un contenedor de Postgres en ejecución."
    exit 1
  fi
  PSQL=(docker exec -i "$CONTAINER_NAME" psql -U "${POSTGRES_USER:-movo}" -d "${POSTGRES_DB:-movo}" -v ON_ERROR_STOP=1)
fi

"${PSQL[@]}" -c "
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  service     text NOT NULL,
  filename    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, filename)
);"

for file in $(printf '%s\n' "${files[@]}" | sort); do
  if [[ "$file" == *.down.sql ]]; then
    continue
  fi
  filename="$(basename "$file")"

  already_applied="$("${PSQL[@]}" -tA -c "SELECT 1 FROM public.schema_migrations WHERE service = '${SERVICE_NAME}' AND filename = '${filename}';")"
  if [ "$already_applied" = "1" ]; then
    echo "Ya aplicada, se saltea: $file"
    continue
  fi

  echo "Aplicando migración: $file"
  # BEGIN/COMMIT explícitos: si el archivo falla a mitad de camino,
  # ON_ERROR_STOP corta la sesión de psql sin llegar al COMMIT, así que el
  # INSERT del ledger tampoco queda aplicado (rollback implícito al cerrar
  # la conexión). No usar CREATE INDEX CONCURRENTLY en estos archivos: no
  # corre dentro de un bloque de transacción.
  {
    echo "BEGIN;"
    cat "$file"
    printf "\nINSERT INTO public.schema_migrations (service, filename) VALUES ('%s', '%s');\n" "$SERVICE_NAME" "$filename"
    echo "COMMIT;"
  } | "${PSQL[@]}"
done
