-- MOVO-209 (review de PR #226): huella del cuerpo del pedido de cada intento de hold.
-- Nullable: los intentos previos (ninguno en producción todavía) no la tienen.
ALTER TABLE "payments"."holds" ADD COLUMN "request_fingerprint" TEXT;
