-- Rollback: 20260731200000_align_user_enums_with_shared.down.sql
-- Description: Revertir el alineamiento de enums de vuelta a los literales
-- originales de la migracion de MOVO-84 (espanol / mayuscula).

ALTER TABLE users.users ALTER COLUMN kyc_status_identity SET DEFAULT 'NOT_STARTED';
ALTER TABLE users.users ALTER COLUMN kyc_status_license SET DEFAULT 'NOT_STARTED';

ALTER TYPE users.kyc_status_enum RENAME VALUE 'expired' TO 'EXPIRED';
ALTER TYPE users.kyc_status_enum RENAME VALUE 'rejected' TO 'REJECTED';
ALTER TYPE users.kyc_status_enum RENAME VALUE 'approved' TO 'APPROVED';
ALTER TYPE users.kyc_status_enum RENAME VALUE 'pending' TO 'PENDING';
ALTER TYPE users.kyc_status_enum RENAME VALUE 'not_started' TO 'NOT_STARTED';

ALTER TYPE users.user_role_enum RENAME VALUE 'carrier' TO 'transportista';
ALTER TYPE users.user_role_enum RENAME VALUE 'sender' TO 'emisor';
