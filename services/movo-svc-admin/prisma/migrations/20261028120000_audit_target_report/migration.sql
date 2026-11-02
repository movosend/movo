-- MOVO-342: cada exportación de un reporte del panel queda en la bitácora con el objetivo `report`.
-- Valor nuevo de enum; no toca filas existentes. Reversión: un valor de enum no se saca sin recrear el tipo.

-- AlterEnum
ALTER TYPE "admin"."admin_target_type" ADD VALUE 'report';
