-- MOVO-354: rol de quien califica, persistido en la fila (antes se inferia en cada lectura
-- de las partes actuales del envio, que pueden cambiar: transferencia de receptor, DD-038).
-- Columna nullable y aditiva. El backfill usa las partes actuales del envio, con la misma
-- precedencia que tenia la inferencia (sender, carrier, receiver); lo que no matchee queda NULL.
--
-- Reversion: `ALTER TABLE "shipments"."ratings" DROP COLUMN "rater_role";` -- solo pierde el
-- rol guardado, el resto de la calificacion no se toca.

-- AlterTable
ALTER TABLE "shipments"."ratings" ADD COLUMN     "rater_role" "shipments"."rating_role_enum";

-- Backfill (a mano: Prisma no genera datos)
UPDATE "shipments"."ratings" AS r
SET "rater_role" = CASE
    WHEN s."sender_id" = r."rater_id" THEN 'sender'::"shipments"."rating_role_enum"
    WHEN s."carrier_id" = r."rater_id" THEN 'carrier'::"shipments"."rating_role_enum"
    WHEN s."receiver_id" = r."rater_id" THEN 'receiver'::"shipments"."rating_role_enum"
END
FROM "shipments"."shipments" AS s
WHERE s."id" = r."shipment_id";
