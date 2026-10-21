-- MOVO-325 (backend de MOVO-33): listado de envíos del panel de administración.

-- B1: ciudad del retiro y de la entrega como dato estructurado. NULL = todavía no resuelta
-- (el reverse geocoding es best-effort al crear y `npm run backfill:cities` completa las anteriores).
ALTER TABLE "shipments"."shipments" ADD COLUMN "pickup_city" TEXT;
ALTER TABLE "shipments"."shipments" ADD COLUMN "delivery_city" TEXT;

-- Nombre visible de cada usuario que participó de un envío, para listar y buscar sin depender de
-- que svc-users esté arriba. Una fila por usuario, no por envío: así un cambio de receptor o de
-- transportista no deja un nombre viejo pegado al envío.
CREATE TABLE "shipments"."user_display_names" (
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_display_names_pkey" PRIMARY KEY ("user_id")
);

-- Backfill con lo que ya está guardado: los snapshots de nombre de las ofertas (la más reciente de
-- cada usuario). Los receptores y quien no ofertó se completan solos al listar (best-effort).
INSERT INTO "shipments"."user_display_names" ("user_id", "name", "updated_at")
SELECT DISTINCT ON (user_id) user_id, name, created_at
FROM (
    SELECT o."carrier_id" AS user_id, o."carrier_name_at_offer" AS name, o."created_at"
    FROM "shipments"."offers" o
    WHERE o."carrier_name_at_offer" IS NOT NULL AND btrim(o."carrier_name_at_offer") <> ''
    UNION ALL
    SELECT s."sender_id", o."sender_name_at_offer", o."created_at"
    FROM "shipments"."offers" o
    JOIN "shipments"."shipments" s ON s."id" = o."shipment_id"
    WHERE o."sender_name_at_offer" IS NOT NULL AND btrim(o."sender_name_at_offer") <> ''
) names
ORDER BY user_id, created_at DESC
ON CONFLICT ("user_id") DO NOTHING;

-- Orden del listado (último cambio de estado) y filtro por ciudad.
CREATE INDEX "shipments_last_status_changed_at_idx"
    ON "shipments"."shipments" ("last_status_changed_at" DESC, "id" DESC);
CREATE INDEX "shipments_pickup_city_idx" ON "shipments"."shipments" ("pickup_city");
