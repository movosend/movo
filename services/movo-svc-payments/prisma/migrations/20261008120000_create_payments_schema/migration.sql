-- MOVO-267: setup base de movo-svc-payments. Solo crea el schema propio del
-- servicio (ADR-003); las tablas (cuentas de MP vinculadas, holds, liquidaciones)
-- llegan con MOVO-111/209/212. Reemplaza a migrations/0001_init.sql (un `SELECT 1`
-- que corría run-migrations.sh), así que no hay nada que baselinear.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "payments";
