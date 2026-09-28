-- MOVO-138 (ADR-025): foto de la cotización al crear el envío, junto a
-- suggested_price_ars y calculation_method. Nunca se recalcula.
-- NULL = sin cotización ("precio a estimar") o envío anterior a demand_fuel_routes_v1;
-- no equivale a false. Sin backfill a propósito: no hay forma de saber si un envío
-- viejo hubiera tenido recargo.
-- Reversión: ALTER TABLE "shipments"."shipments" DROP COLUMN "high_demand";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "high_demand" BOOLEAN;
