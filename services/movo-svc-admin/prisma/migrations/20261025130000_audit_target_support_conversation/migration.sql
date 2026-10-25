-- MOVO-322: las acciones de la bandeja de soporte quedan en la bitácora con el objetivo `support_conversation`.
-- Valor nuevo de enum; no toca filas existentes. Reversión: un valor de enum no se saca sin recrear el tipo.

-- AlterEnum
ALTER TYPE "admin"."admin_target_type" ADD VALUE 'support_conversation';
