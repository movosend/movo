-- DD-055 (pago simulado): marca de un envío que un admin pasó a `assigned` sin hold real de Mercado Pago.
-- Columna nueva con default, no toca datos existentes (los envíos previos quedan con `payment_simulated = false`).
-- Reversión:
--   ALTER TABLE "shipments"."shipments" DROP COLUMN "payment_simulated";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "payment_simulated" BOOLEAN NOT NULL DEFAULT false;
