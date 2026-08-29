-- MOVO-142: bounding box de GET /shipments/available -- pickup_lat/pickup_lng contra
-- el origen del trayecto del transportista, delivery_lat/delivery_lng contra su
-- destino (AND: ambos extremos tienen que caer dentro del radio). status va primero en
-- los dos índices porque el filtro siempre arranca por status='published'.
-- Escrita a mano (Prisma no tiene shadow database configurada en este entorno para
-- generar el diff automáticamente) -- mismo formato que las migraciones anteriores.
CREATE INDEX "shipments_status_pickup_lat_lng_idx" ON "shipments"."shipments"("status", "pickup_lat", "pickup_lng");

CREATE INDEX "shipments_status_delivery_lat_lng_idx" ON "shipments"."shipments"("status", "delivery_lat", "delivery_lng");
