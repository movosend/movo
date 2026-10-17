-- MOVO-311: la deuda de la cuenta corriente se cobra en el `application_fee` del hold.
-- 1) El hold guarda el precio acordado aparte del monto que se le cobra al emisor (precio + recargo),
--    la comisión de Movo y la deuda que lleva, calculados UNA vez por intento.
-- 2) La liquidación separa la comisión de Movo de la deuda cobrada.
-- 3) Un hold que se cierra sin cobrar (rechazado, liberado o vencido) anula en la misma transacción
--    los movimientos `reserved` que lo referencian: la deuda vuelve a quedar pendiente sin importar
--    por qué camino se cerró (creación, liberación, `?sync`, webhook).

ALTER TABLE "payments"."holds"
  ADD COLUMN "base_amount_ars" DECIMAL(12,2),
  ADD COLUMN "commission_ars" DECIMAL(12,2),
  ADD COLUMN "debt_offset_ars" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "debt_surcharge_ars" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Antes de MOVO-311 el monto era el precio y el `application_fee` la comisión.
UPDATE "payments"."holds" SET "base_amount_ars" = "amount_ars", "commission_ars" = "application_fee_ars";

ALTER TABLE "payments"."holds"
  ALTER COLUMN "base_amount_ars" SET NOT NULL,
  ALTER COLUMN "commission_ars" SET NOT NULL;

ALTER TABLE "payments"."settlements"
  ADD COLUMN "debt_offset_ars" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "debt_surcharge_ars" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE INDEX "user_ledger_entries_hold_id_idx" ON "payments"."user_ledger_entries"("hold_id");

CREATE FUNCTION "payments"."holds_void_debt_reservations"() RETURNS trigger AS $$
BEGIN
  UPDATE "payments"."user_ledger_entries"
     SET "status" = 'voided'
   WHERE "hold_id" = NEW."id" AND "status" = 'reserved';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "holds_void_debt_reservations" AFTER UPDATE OF "status" ON "payments"."holds"
  FOR EACH ROW
  WHEN (NEW."status" IN ('cancelled', 'rejected') AND OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION "payments"."holds_void_debt_reservations"();
