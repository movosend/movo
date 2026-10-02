-- MOVO-258 (D7): backfill de las ofertas de envíos que ya estaban cancelados antes de que
-- `updateStatus` empezara a cerrarlas. Va en una migración aparte de la que agrega el valor
-- 'shipment_cancelled' al enum porque Postgres no permite usar un valor de enum en la
-- misma transacción en la que se lo agregó.
--
-- Alcance: las `accepted` y las `pending` todavía vigentes de un envío `cancelled`. Una
-- `pending` ya vencida por fecha queda `pending` en base y se lee como `expired`, igual
-- que en el código; `rejected`/`withdrawn`/`superseded` no se reetiquetan.
--
-- Reversión: no hay forma de distinguir cuáles de estas filas eran `accepted` y cuáles
-- `pending` una vez aplicado. Antes de correrlo en un ambiente con datos reales, conviene
-- guardar `SELECT id, status FROM shipments.offers` de las filas afectadas.
UPDATE "shipments"."offers" AS o
SET "status" = 'shipment_cancelled'
FROM "shipments"."shipments" AS s
WHERE o."shipment_id" = s."id"
  AND s."status" = 'cancelled'
  AND (
    o."status" = 'accepted'
    OR (o."status" = 'pending' AND (o."expires_at" IS NULL OR o."expires_at" >= now()))
  );
