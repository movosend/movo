-- Migration: 20260804210000_update_user_entity_movo_92.sql
-- Description: Actualizacion de la Entidad User (MOVO-92).
-- 1. Crear enum account_status_enum ('active', 'banned', 'deleted')
-- 2. Eliminar campos obsoletos de KYC (last_kyc_verification_identity_id, last_kyc_verification_license_id)
-- 3. Reemplazar is_banned por status (account_status_enum default 'active')
-- 4. Agregar columna birthdate (DATE)

CREATE TYPE users.account_status_enum AS ENUM ('active', 'banned', 'deleted');

ALTER TABLE users.users
  DROP COLUMN IF EXISTS last_kyc_verification_identity_id,
  DROP COLUMN IF EXISTS last_kyc_verification_license_id,
  DROP COLUMN IF EXISTS is_banned,
  ADD COLUMN status users.account_status_enum NOT NULL DEFAULT 'active',
  ADD COLUMN birthdate DATE;
