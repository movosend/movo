-- MOVO-260: Backfill de viajes vencidos.
-- Este backfill pasa todos los viajes en estado `cancelled` a `expired`.
-- Limitación: Incluye también a los viajes que el transportista canceló explícitamente (vía PATCH en la versión anterior). En desarrollo esto es tolerable.
-- Reversión: No hay forma de distinguir en la base de datos cuáles eran cancelaciones explícitas de las expiraciones automáticas. Se dejan todos como `expired`.
UPDATE "shipments"."trips" SET "status" = 'expired' WHERE "status" = 'cancelled';
