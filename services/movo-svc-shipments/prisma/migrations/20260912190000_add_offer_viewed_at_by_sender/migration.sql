-- MOVO-189: instante en que el emisor vio una oferta pending por primera vez (nunca
-- "última vez"). Nullable -- las ofertas existentes quedan sin vista hasta la próxima
-- lectura de GET /shipments/:id/offers, que la completa con un updateMany best-effort.

-- AlterTable
ALTER TABLE "shipments"."offers" ADD COLUMN "viewed_at_by_sender" TIMESTAMPTZ;
