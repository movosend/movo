-- MOVO-187: snapshot de identidad y confianza del EMISOR al momento de ofertar,
-- simétrico al snapshot del transportista que ya existía (carrier_rating_at_offer/
-- carrier_name_at_offer, MOVO-102/143). Las tres columnas son nullable: un fallo al
-- resolver el perfil del emisor no bloquea la creación de la oferta (AC3).

-- AlterTable
ALTER TABLE "shipments"."offers" ADD COLUMN "sender_name_at_offer" TEXT;
ALTER TABLE "shipments"."offers" ADD COLUMN "sender_verified_at_offer" BOOLEAN;
ALTER TABLE "shipments"."offers" ADD COLUMN "sender_rating_at_offer" DECIMAL;
