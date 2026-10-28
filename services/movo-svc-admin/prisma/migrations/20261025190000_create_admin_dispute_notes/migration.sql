-- MOVO-337: notas internas del panel sobre una disputa, y `dispute` como objetivo de la bitácora. Las notas son dato
-- del panel (las partes nunca las ven): viven acá y no en `shipments`. `dispute_id`/`admin_id` sin FK (viven en otros
-- schemas), mismo criterio que `admin_user_notes`.

-- AlterEnum
ALTER TYPE "admin"."admin_target_type" ADD VALUE 'dispute';

-- CreateTable
CREATE TABLE "admin"."admin_dispute_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispute_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_dispute_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_dispute_notes_dispute_id_created_at_id_idx" ON "admin"."admin_dispute_notes"("dispute_id", "created_at" DESC, "id" DESC);

-- Solo agregar, igual que las notas de usuario: una nota no se edita ni se borra. Sin trigger de TRUNCATE para que los
-- tests puedan limpiar la tabla.
CREATE FUNCTION "admin"."admin_dispute_notes_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin.admin_dispute_notes es de solo agregar filas (% no permitido)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admin_dispute_notes_no_update_delete"
  BEFORE UPDATE OR DELETE ON "admin"."admin_dispute_notes"
  FOR EACH ROW EXECUTE FUNCTION "admin"."admin_dispute_notes_append_only"();
