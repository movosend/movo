-- Migration: 20260728160000_create_users_schema.sql
-- Description: Create users schema, users table, user_roles table, enums, indexes, and updated_at trigger

CREATE SCHEMA IF NOT EXISTS users;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'kyc_status_enum' AND n.nspname = 'users') THEN
    CREATE TYPE users.kyc_status_enum AS ENUM (
      'NOT_STARTED', 
      'PENDING', 
      'APPROVED', 
      'REJECTED', 
      'EXPIRED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'user_role_enum' AND n.nspname = 'users') THEN
    CREATE TYPE users.user_role_enum AS ENUM (
      'emisor', 
      'transportista', 
      'admin'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  dni VARCHAR(50),
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  photo_url TEXT,
  kyc_status_identity users.kyc_status_enum NOT NULL DEFAULT 'NOT_STARTED',
  last_kyc_verification_identity_id UUID,
  kyc_status_license users.kyc_status_enum NOT NULL DEFAULT 'NOT_STARTED',
  last_kyc_verification_license_id UUID,
  is_banned BOOLEAN NOT NULL DEFAULT false,
  banned_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_phone_key UNIQUE (phone)
);

CREATE TABLE IF NOT EXISTS users.user_roles (
  user_id UUID NOT NULL REFERENCES users.users(id) ON DELETE CASCADE,
  role users.user_role_enum NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users.users (LOWER(email));
CREATE INDEX IF NOT EXISTS users_phone_idx ON users.users (phone);
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON users.user_roles (user_id);

CREATE OR REPLACE FUNCTION users.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users.users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users.users
  FOR EACH ROW
  EXECUTE FUNCTION users.update_updated_at_column();
