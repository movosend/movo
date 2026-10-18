-- MOVO-288: schema admin (ADR-003) y bitácora del panel. Reemplaza migrations/0001_init.sql,
-- el placeholder del scaffold que aplicaba scripts/run-migrations.sh.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "admin";

-- CreateEnum
CREATE TYPE "admin"."audit_outcome" AS ENUM ('succeeded', 'failed', 'unknown');

-- CreateEnum
CREATE TYPE "admin"."admin_target_type" AS ENUM ('user', 'admin_role', 'shipment', 'chat_report', 'user_report');

-- CreateTable
CREATE TABLE "admin"."audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" "admin"."admin_target_type" NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "context" JSONB,
    "outcome" "admin"."audit_outcome" NOT NULL,
    "error_code" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_created_at_id_idx" ON "admin"."audit_log"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_log_admin_id_created_at_idx" ON "admin"."audit_log"("admin_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_target_created_at_idx" ON "admin"."audit_log"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "admin"."audit_log"("action", "created_at" DESC);

-- Append-only en la base, no solo por convención (AC4): ni el servicio ni una consulta
-- a mano pueden editar o borrar una fila sin deshabilitar el trigger a propósito. Un
-- error de carga se corrige agregando otra fila, nunca reescribiendo la historia.
CREATE FUNCTION "admin"."audit_log_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin.audit_log es de solo agregar filas (% no permitido)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "admin"."audit_log"
  FOR EACH ROW EXECUTE FUNCTION "admin"."audit_log_append_only"();

CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "admin"."audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "admin"."audit_log_append_only"();
