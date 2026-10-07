-- MOVO-258 (D3): `acceptOffer` pisa la ventana de retiro del envío con la acordada. Estas
-- columnas guardan la que pidió el emisor, para restaurarla si el envío vuelve a `published`
-- (hold fallido, MOVO-210) en vez de dejarlo con la ventana del transportista que perdió la
-- asignación. NULL = sin oferta aceptada.
-- Reversión: ALTER TABLE "shipments"."shipments" DROP COLUMN "original_pickup_date",
--   DROP COLUMN "original_pickup_time_window_start", DROP COLUMN "original_pickup_time_window_end";
-- (los envíos backfilleados quedarían con la ventana acordada como única).
-- AlterTable
ALTER TABLE "shipments"."shipments"
  ADD COLUMN "original_pickup_date" DATE,
  ADD COLUMN "original_pickup_time_window_start" TIME,
  ADD COLUMN "original_pickup_time_window_end" TIME;

-- Backfill de D3: los envíos ya asignados antes de este deploy conservan la ventana ORIGINAL
-- del emisor en `pickup_*` (solo el `acceptOffer` nuevo la copia). Sin esto, el barrido de
-- retiro no realizado mediría contra la fecha original y podría cancelar un envío cuyo retiro
-- acordado es posterior (MOVO-177 permite hasta +3 días). Copia la ventana de la oferta
-- `accepted` al envío y guarda la original. La franja solo se pisa si la oferta propuso una.
UPDATE "shipments"."shipments" AS s
SET "original_pickup_date" = s."pickup_date",
    "original_pickup_time_window_start" = s."pickup_time_window_start",
    "original_pickup_time_window_end" = s."pickup_time_window_end",
    "pickup_date" = o."offered_date",
    "pickup_time_window_start" = COALESCE(o."offered_pickup_time_window_start"::time, s."pickup_time_window_start"),
    "pickup_time_window_end" = COALESCE(o."offered_pickup_time_window_end"::time, s."pickup_time_window_end")
FROM "shipments"."offers" AS o
WHERE o."shipment_id" = s."id"
  AND o."status" = 'accepted'
  AND s."status" IN ('assignment_pending', 'assigned_unfunded', 'assigned')
  AND s."original_pickup_date" IS NULL;
