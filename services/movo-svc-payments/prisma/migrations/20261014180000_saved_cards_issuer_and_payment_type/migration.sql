-- MOVO-101: banco emisor y tipo de tarjeta que devuelve MP al guardarla, para mostrarlos en
-- la lista de tarjetas. Nulas en las filas previas (no se puede reconstruir sin MP).

-- AlterTable
ALTER TABLE "payments"."saved_cards" ADD COLUMN "issuer_name" TEXT,
ADD COLUMN "payment_type" TEXT;
