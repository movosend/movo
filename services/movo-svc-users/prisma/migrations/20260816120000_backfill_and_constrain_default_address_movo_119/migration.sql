-- MOVO-119: CRUD de direcciones guardadas.
--
-- Backfill: las filas de `address` creadas por POST /auth/register (MOVO-73) nunca se
-- marcaron is_default -- hoy es 1 fila por usuario, así que no hay conflicto de "dos
-- defaults" que resolver.
UPDATE "users"."address" SET "is_default" = true WHERE "is_default" = false;

-- Índice único parcial: nunca más de una fila is_default = true por usuario, a nivel
-- de DB además de la transacción de aplicación (address-repository.ts) -- mismo
-- criterio que el índice único parcial de AC7 de MOVO-102 (offers_shipment_carrier_pending_unique)
-- para una invariante análoga. Escrito a mano, no generado por `prisma migrate diff`
-- (no hay cambio de schema.prisma que lo represente).
CREATE UNIQUE INDEX "address_user_id_default_unique"
  ON "users"."address" ("user_id")
  WHERE "is_default" = true;
