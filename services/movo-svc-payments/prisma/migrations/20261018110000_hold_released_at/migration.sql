-- MOVO-303: cuándo se liberó un hold sin cobrar, para la línea de tiempo del detalle de una transacción.
-- Un hold se cierra desde varios lugares (liberación explícita, webhook de MP, vencimiento): en vez de repetir la
-- marca en cada uno, la fija un trigger la primera vez que `status` pasa a `cancelled`. `updated_at` no sirve: cambia
-- con cualquier otro update posterior (por ejemplo, completar la marca de la tarjeta).
ALTER TABLE "payments"."holds" ADD COLUMN "released_at" TIMESTAMPTZ;

CREATE FUNCTION "payments"."holds_set_released_at"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'cancelled' AND OLD."status" IS DISTINCT FROM 'cancelled' AND NEW."released_at" IS NULL THEN
    NEW."released_at" := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "holds_set_released_at" BEFORE UPDATE ON "payments"."holds"
  FOR EACH ROW EXECUTE FUNCTION "payments"."holds_set_released_at"();

-- Los ya cancelados: lo más cercano que hay es su última actualización.
UPDATE "payments"."holds" SET "released_at" = "updated_at" WHERE "status" = 'cancelled' AND "released_at" IS NULL;
