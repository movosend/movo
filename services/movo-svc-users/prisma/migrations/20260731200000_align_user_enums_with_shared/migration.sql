-- Migration: 20260731200000_align_user_enums_with_shared.sql
-- Description: Alinear los enums de rol y KYC de users.users con los valores de
-- @movo/shared (UserRole/KycStatus), en vez de mantener una capa de mapeo en la
-- aplicacion. Decision de equipo posterior a MOVO-84/MOVO-87 (ver MOVO-91,
-- MOVO-67, MOVO-87 en Linear). RENAME VALUE preserva las filas existentes,
-- solo re-etiqueta el enum -- no hace falta migrar datos ni recrear columnas.

ALTER TYPE users.user_role_enum RENAME VALUE 'emisor' TO 'sender';
ALTER TYPE users.user_role_enum RENAME VALUE 'transportista' TO 'carrier';
-- 'admin' no cambia

ALTER TYPE users.kyc_status_enum RENAME VALUE 'NOT_STARTED' TO 'not_started';
ALTER TYPE users.kyc_status_enum RENAME VALUE 'PENDING' TO 'pending';
ALTER TYPE users.kyc_status_enum RENAME VALUE 'APPROVED' TO 'approved';
ALTER TYPE users.kyc_status_enum RENAME VALUE 'REJECTED' TO 'rejected';
ALTER TYPE users.kyc_status_enum RENAME VALUE 'EXPIRED' TO 'expired';

-- Los DEFAULT de columna quedan resueltos por OID (no por texto), asi que el
-- RENAME ya los actualiza solo -- se re-especifican igual para que la
-- migracion sea explicita y no dependa de ese detalle interno de Postgres.
ALTER TABLE users.users ALTER COLUMN kyc_status_identity SET DEFAULT 'not_started';
ALTER TABLE users.users ALTER COLUMN kyc_status_license SET DEFAULT 'not_started';
