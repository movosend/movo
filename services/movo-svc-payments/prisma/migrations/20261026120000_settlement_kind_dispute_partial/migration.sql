-- MOVO-337 (DD-056): la captura parcial de una disputa tiene su propio `kind`; antes se registraba como
-- `cancellation_penalty` y el ledger y el panel la mostraban como penalidad por cancelación.
ALTER TYPE "payments"."settlement_kind" ADD VALUE IF NOT EXISTS 'dispute_partial';
