-- Rollback: 20260728160000_create_users_schema.down.sql
-- Description: Drop users schema, tables, enums, triggers, and functions

DROP TRIGGER IF EXISTS update_users_updated_at ON users.users;
DROP FUNCTION IF EXISTS users.update_updated_at_column();

DROP INDEX IF EXISTS users.user_roles_user_id_idx;
DROP INDEX IF EXISTS users.users_phone_idx;
DROP INDEX IF EXISTS users.users_email_lower_idx;

DROP TABLE IF EXISTS users.user_roles CASCADE;
DROP TABLE IF EXISTS users.users CASCADE;

DROP TYPE IF EXISTS users.user_role_enum CASCADE;
DROP TYPE IF EXISTS users.kyc_status_enum CASCADE;

DROP SCHEMA IF EXISTS users CASCADE;
