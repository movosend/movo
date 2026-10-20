-- MOVO-294: notas internas del panel sobre un usuario. Son dato del panel, no del usuario:
-- viven acá y no en `users`, y el usuario nunca las ve. `user_id`/`admin_id` sin FK (viven
-- en el schema `users`), mismo criterio que `audit_log`.

-- CreateTable
CREATE TABLE "admin"."admin_user_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_user_notes_user_id_created_at_id_idx" ON "admin"."admin_user_notes"("user_id", "created_at" DESC, "id" DESC);

-- Solo agregar, igual que la bitácora: una nota no se edita ni se borra, así el historial es
-- confiable. Función propia (no la de `audit_log`) para que el mensaje nombre la tabla.
CREATE FUNCTION "admin"."admin_user_notes_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin.admin_user_notes es de solo agregar filas (% no permitido)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admin_user_notes_no_update_delete"
  BEFORE UPDATE OR DELETE ON "admin"."admin_user_notes"
  FOR EACH ROW EXECUTE FUNCTION "admin"."admin_user_notes_append_only"();
