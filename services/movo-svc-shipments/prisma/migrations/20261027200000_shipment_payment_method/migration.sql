-- MOVO-37: la modalidad de pago pasa de texto libre sin uso (nadie la escribía) a un enum obligatorio.
-- Todos los envíos anteriores se pagaron con tarjeta.
CREATE TYPE "shipments"."payment_method" AS ENUM ('card', 'cash');

ALTER TABLE "shipments"."shipments"
  ALTER COLUMN "payment_method" TYPE "shipments"."payment_method" USING ('card'::"shipments"."payment_method"),
  ALTER COLUMN "payment_method" SET DEFAULT 'card',
  ALTER COLUMN "payment_method" SET NOT NULL;
