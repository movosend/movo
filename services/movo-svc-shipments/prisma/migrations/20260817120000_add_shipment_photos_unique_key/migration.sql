-- Fix de review en PR #76 (MOVO-81, tmvergara): sin una restricción única en
-- (shipment_id, s3_key), confirmar la misma foto dos veces (reintento del cliente tras
-- un timeout, por ejemplo) insertaba dos filas para el mismo objeto de S3 y el gate de
-- AC6 (`MIN_CREATION_PHOTOS_TO_PUBLISH`) contaba evidencia duplicada como si fueran dos
-- fotos reales distintas.

-- CreateIndex
CREATE UNIQUE INDEX "shipment_photos_shipment_id_s3_key_key" ON "shipments"."shipment_photos"("shipment_id", "s3_key");
