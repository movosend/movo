-- MOVO-177: franja horaria alternativa de retiro cuando el transportista propone un
-- día/horario distinto al pedido por el emisor. Null cuando la oferta usa la ventana
-- del envío tal cual.

ALTER TABLE "shipments"."offers"
  ADD COLUMN "offered_pickup_time_window_start" VARCHAR(8),
  ADD COLUMN "offered_pickup_time_window_end" VARCHAR(8);
