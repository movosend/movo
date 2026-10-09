-- MOVO-111: cuentas de Mercado Pago vinculadas por OAuth (una por transportista).

-- CreateTable
CREATE TABLE "payments"."carrier_mp_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "mp_user_id" TEXT NOT NULL,
    "email" TEXT,
    "nickname" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "public_key" TEXT,
    "scope" TEXT,
    "token_expires_at" TIMESTAMPTZ,
    "connected_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "unlinked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "carrier_mp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carrier_mp_accounts_user_id_key" ON "payments"."carrier_mp_accounts"("user_id");

-- Una cuenta de MP vinculada a un solo usuario de Movo a la vez. Índice único
-- PARCIAL, a mano porque Prisma no lo representa: una vinculación desvinculada o
-- revocada no bloquea que otro usuario vincule esa misma cuenta. Una fila con el
-- token vencido pero sin `revoked_at` sigue bloqueando (`now()` no puede ir en el
-- predicado); MOVO-243 la marca revocada cuando el refresh falla.
CREATE UNIQUE INDEX "carrier_mp_accounts_mp_user_id_active_key"
  ON "payments"."carrier_mp_accounts" ("mp_user_id")
  WHERE "revoked_at" IS NULL AND "unlinked_at" IS NULL;
