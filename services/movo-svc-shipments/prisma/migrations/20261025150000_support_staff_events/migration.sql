-- MOVO-322: eventos del equipo de soporte (asignación, prioridad, tema, vínculo, resolución). Solo los ve el panel.
-- Valor nuevo de enum; no toca datos existentes. Reversión: un valor de enum no se puede sacar en Postgres sin
-- recrear el tipo; si hiciera falta, borrar antes las filas con kind = 'event'.

-- AlterEnum
ALTER TYPE "shipments"."support_message_kind_enum" ADD VALUE 'event';
