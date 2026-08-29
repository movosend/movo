-- MOVO-142: bounding box de GET /shipments/available (MOVO-50 corredor, no AND de dos círculos).
-- Sin destino: retiro dentro de radiusKm del origen (círculo simple).
-- Con destino: retiro Y entrega medidos contra la DISTANCIA PERPENDICULAR al segmento
-- origen→destino (corredor), no como dos círculos independientes. Esto permite que un
-- envío retirado/entregado en el MEDIO de un trayecto largo (ej. Oncativo, Córdoba-Villa María)
-- aparezca aunque esté lejos de los dos extremos del trayecto.
-- status va primero en los dos índices porque el filtro siempre arranca por status='published'.
-- Escrita a mano (Prisma no tiene shadow database configurada en este entorno para
-- generar el diff automáticamente) -- mismo formato que las migraciones anteriores.
CREATE INDEX "shipments_status_pickup_lat_lng_idx" ON "shipments"."shipments"("status", "pickup_lat", "pickup_lng");

CREATE INDEX "shipments_status_delivery_lat_lng_idx" ON "shipments"."shipments"("status", "delivery_lat", "delivery_lng");
