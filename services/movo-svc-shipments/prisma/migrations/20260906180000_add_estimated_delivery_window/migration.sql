-- MOVO-180: entrega estimada (día + franja horaria) de la oferta, propagada al envío
-- cuando se acepta. Los tres campos son nullable en ambas tablas -- offers.offers
-- porque no son obligatorios al ofertar (mobile todavía no los recolecta, ver
-- CLAUDE.md), shipments.shipments porque solo se completan cuando el envío tiene una
-- oferta aceptada. El horario se persiste como VARCHAR("HH:MM:SS"), no TIME, para no
-- heredar el gotcha de timezone-anclaje de pickup_time_window_start/end (ver
-- services/movo-svc-shipments/CLAUDE.md, MOVO-80).

-- AlterTable
ALTER TABLE "shipments"."offers" ADD COLUMN "estimated_delivery_date" DATE;
ALTER TABLE "shipments"."offers" ADD COLUMN "estimated_delivery_time_window_start" VARCHAR(8);
ALTER TABLE "shipments"."offers" ADD COLUMN "estimated_delivery_time_window_end" VARCHAR(8);

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "estimated_delivery_date" DATE;
ALTER TABLE "shipments"."shipments" ADD COLUMN "estimated_delivery_time_window_start" VARCHAR(8);
ALTER TABLE "shipments"."shipments" ADD COLUMN "estimated_delivery_time_window_end" VARCHAR(8);
