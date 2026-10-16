-- MOVO-309 (review PR 259): endurece la cuenta corriente.
-- 1) `created_at` en milisegundos: es la precisión del cursor de paginación, y con microsegundos
--    (el default de Postgres) una fila insertada por fuera de la app se saltearía entre páginas.
-- 2) `voided` y `settled` ya no se reabren: de `settled` solo se sale a `voided`, y `voided` es terminal.

ALTER TABLE "payments"."user_ledger_entries" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3);

CREATE OR REPLACE FUNCTION "payments"."user_ledger_entries_guard"() RETURNS trigger AS $$
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
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND (OLD."status" = 'voided' OR (OLD."status" = 'settled' AND NEW."status" <> 'voided')) THEN
    RAISE EXCEPTION 'user_ledger_entries: transición de status no permitida (% -> %)', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
