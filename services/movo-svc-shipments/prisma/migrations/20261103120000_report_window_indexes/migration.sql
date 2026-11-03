-- MOVO-35: los reportes del panel eligen sus envíos por la ventana del rango, sin recorrer toda la historia.
-- Reversión:
--   DROP INDEX "shipments"."shipment_events_created_at_idx";
--   DROP INDEX "shipments"."shipments_delivered_at_idx";

-- CreateIndex
CREATE INDEX "shipment_events_created_at_idx" ON "shipments"."shipment_events"("created_at");

-- CreateIndex
CREATE INDEX "shipments_delivered_at_idx" ON "shipments"."shipments"("delivered_at");
