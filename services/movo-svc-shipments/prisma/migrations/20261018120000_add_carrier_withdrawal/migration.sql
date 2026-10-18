-- MOVO-310: el transportista asignado se baja del envío y el envío vuelve a `published`. Su oferta
-- `accepted` pasa a `carrier_withdrawn`; con menos de 12 h para el retiro la penalidad queda como
-- deuda en su cuenta corriente (`pending` hasta registrarla en payments, `debt` después).
-- Reversión: DROP de las tres columnas; Postgres no permite quitar un valor de un enum (recrear el
-- tipo si hiciera falta, misma salvedad que 20261010180000_add_assignment_lapsed_offer_status).

-- AlterEnum
ALTER TYPE "shipments"."offer_status_enum" ADD VALUE 'carrier_withdrawn';

-- AlterTable
ALTER TABLE "shipments"."offers"
  ADD COLUMN "carrier_withdrawn_at" TIMESTAMPTZ,
  ADD COLUMN "withdrawal_penalty_ars" DECIMAL(12,2),
  ADD COLUMN "withdrawal_penalty_status" "shipments"."cancellation_penalty_status_enum";

