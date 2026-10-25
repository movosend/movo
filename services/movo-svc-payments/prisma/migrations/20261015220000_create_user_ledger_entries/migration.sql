-- MOVO-309 (DD-044): cuenta corriente del usuario. Solo inserción: el monto, el tipo y
-- las referencias no se editan nunca y no se borra nada; lo único que cambia de una fila
-- es `status` (pending -> reserved -> settled, o voided). Un error se corrige anulando.

-- CreateEnum
CREATE TYPE "payments"."ledger_entry_type" AS ENUM (
  'cancellation_penalty', 'penalty_capture', 'cash_commission', 'fee_offset',
  'payment_surcharge', 'voluntary_payment', 'manual_adjustment'
);
CREATE TYPE "payments"."ledger_entry_status" AS ENUM ('pending', 'reserved', 'settled', 'voided');
CREATE TYPE "payments"."ledger_role" AS ENUM ('sender', 'carrier');

-- CreateTable
CREATE TABLE "payments"."user_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_at_origin" "payments"."ledger_role",
    "type" "payments"."ledger_entry_type" NOT NULL,
    -- Con signo: positivo = el usuario debe, negativo = pago o saldo a favor.
    "amount_ars" DECIMAL(12,2) NOT NULL,
    "status" "payments"."ledger_entry_status" NOT NULL DEFAULT 'pending',
    "shipment_id" UUID,
    "hold_id" UUID,
    "payment_id" TEXT,
    "reason" TEXT,
    "admin_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_ledger_entries_amount_nonzero" CHECK ("amount_ars" <> 0),
    -- Un ajuste manual sin motivo ni autor no se puede registrar ni por SQL directo.
    CONSTRAINT "user_ledger_entries_manual_adjustment_reason" CHECK (
      "type" <> 'manual_adjustment' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0 AND "admin_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "user_ledger_entries_idempotency_key_key" ON "payments"."user_ledger_entries"("idempotency_key");
CREATE INDEX "user_ledger_entries_user_id_created_at_id_idx"
  ON "payments"."user_ledger_entries"("user_id", "created_at" DESC, "id" DESC);
CREATE INDEX "user_ledger_entries_shipment_id_idx" ON "payments"."user_ledger_entries"("shipment_id");
-- Para `oldestUnpaidAt`: deuda sin saldar de un usuario.
CREATE INDEX "user_ledger_entries_unpaid_idx" ON "payments"."user_ledger_entries"("user_id", "created_at")
  WHERE "status" IN ('pending', 'reserved') AND "amount_ars" > 0;

-- AddForeignKey (interna al schema `payments`)
ALTER TABLE "payments"."user_ledger_entries" ADD CONSTRAINT "user_ledger_entries_hold_id_fkey"
  FOREIGN KEY ("hold_id") REFERENCES "payments"."holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Inmutabilidad: nunca se borra, y de un UPDATE solo se acepta el cambio de `status`.
CREATE FUNCTION "payments"."user_ledger_entries_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user_ledger_entries es de solo inserción: no se borran movimientos';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."role_at_origin" IS DISTINCT FROM OLD."role_at_origin"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."amount_ars" IS DISTINCT FROM OLD."amount_ars"
     OR NEW."shipment_id" IS DISTINCT FROM OLD."shipment_id"
     OR NEW."hold_id" IS DISTINCT FROM OLD."hold_id"
     OR NEW."payment_id" IS DISTINCT FROM OLD."payment_id"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."admin_id" IS DISTINCT FROM OLD."admin_id"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'user_ledger_entries es de solo inserción: solo puede cambiar status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_ledger_entries_no_delete" BEFORE DELETE ON "payments"."user_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "payments"."user_ledger_entries_guard"();
CREATE TRIGGER "user_ledger_entries_only_status_update" BEFORE UPDATE ON "payments"."user_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "payments"."user_ledger_entries_guard"();
