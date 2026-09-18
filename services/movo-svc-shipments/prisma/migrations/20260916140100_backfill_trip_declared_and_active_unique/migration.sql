-- MOVO-221 (cont.): ahora que 'declared' ya está commiteado en el enum (migración
-- anterior), se puede usar en este UPDATE.
--
-- Backfill de datos: los viajes existentes con status='active' pasan a 'declared' --
-- hoy ningún viaje pudo "iniciarse" de verdad todavía (POST /trips/:id/start no
-- existía), así que ningún 'active' actual representa un viaje realmente en curso.
UPDATE "shipments"."trips" SET "status" = 'declared' WHERE "status" = 'active';

-- El default de la columna pasa de 'active' a 'declared' (ya reflejado en
-- prisma/schema.prisma -- @default(declared)).
ALTER TABLE "shipments"."trips" ALTER COLUMN "status" SET DEFAULT 'declared';

-- Límite de negocio "solo puede haber 1 viaje active por cuenta a la vez": índice
-- único parcial, no representable en el DSL de Prisma -- mismo patrón que
-- offers_shipment_carrier_pending_unique (MOVO-102, prisma/migrations/
-- 20260815222908_create_offers_table). Corre después del backfill de arriba, así que
-- no hay ninguna fila 'active' preexistente que pueda violarlo.
CREATE UNIQUE INDEX "trips_carrier_active_unique"
  ON "shipments"."trips" ("carrier_id")
  WHERE "status" = 'active';
