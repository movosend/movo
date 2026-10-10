-- MOVO-210: estado de oferta para la que fue aceptada pero cuya asignación no prosperó (el emisor
-- no pagó a tiempo o MP perdió la reserva) y el envío volvió a `published`. No es un rechazo.
-- Reversión: Postgres no permite quitar un valor de un enum; recrear el tipo si hiciera falta
-- (misma salvedad que 20261002120000_add_shipment_cancelled_offer_and_transit_anomaly).
-- AlterEnum
ALTER TYPE "shipments"."offer_status_enum" ADD VALUE 'assignment_lapsed';
