-- MOVO-296: sanciones de cuenta (suspensión e inhabilitación).

-- `banned` pasa a significar "inhabilitada"; `suspended` se agrega al final del enum.
ALTER TYPE "users"."account_status_enum" ADD VALUE 'suspended';

-- CreateEnum
CREATE TYPE "users"."account_sanction_type_enum" AS ENUM ('suspension', 'disable');

-- CreateEnum
CREATE TYPE "users"."account_sanction_closed_cause_enum" AS ENUM ('lifted', 'replaced', 'escalated', 'expired');

-- CreateTable
CREATE TABLE "users"."account_sanctions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "users"."account_sanction_type_enum" NOT NULL,
    "reason" TEXT NOT NULL,
    "internal_note" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ,
    "applied_by" UUID NOT NULL,
    "lifted_at" TIMESTAMPTZ,
    "lifted_by" UUID,
    "lift_reason" TEXT,
    "closed_cause" "users"."account_sanction_closed_cause_enum",

    CONSTRAINT "account_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_sanctions_user_id_started_at_idx" ON "users"."account_sanctions"("user_id", "started_at");

-- Una sola sanción vigente por usuario (la que no tiene `lifted_at`).
CREATE UNIQUE INDEX "account_sanctions_one_open_per_user_idx" ON "users"."account_sanctions"("user_id") WHERE "lifted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "users"."account_sanctions" ADD CONSTRAINT "account_sanctions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Solo se agregan filas (el borrado en cascada de un usuario se deja pasar, como en el resto de
-- las tablas del esquema) y se completan los campos de levantamiento (una sola vez).
CREATE FUNCTION "users"."account_sanctions_guard"() RETURNS trigger AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.type IS DISTINCT FROM OLD.type
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.internal_note IS DISTINCT FROM OLD.internal_note
        OR NEW.started_at IS DISTINCT FROM OLD.started_at
        OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
        OR NEW.applied_by IS DISTINCT FROM OLD.applied_by THEN
        RAISE EXCEPTION 'account_sanctions: solo se pueden completar los campos de levantamiento';
    END IF;
    IF OLD.lifted_at IS NOT NULL THEN
        RAISE EXCEPTION 'account_sanctions: la sanción ya está cerrada';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "account_sanctions_guard"
    BEFORE UPDATE ON "users"."account_sanctions"
    FOR EACH ROW EXECUTE FUNCTION "users"."account_sanctions_guard"();
