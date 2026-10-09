// Schemas de /payments/mp-connect (MOVO-111). Reflejan `types/mp-connect.ts` de
// @movo/shared; el Swagger se genera desde acá.

const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        statusCode: { type: "number" },
      },
    },
    requestId: { type: "string" },
  },
} as const;

const account = {
  type: ["object", "null"],
  required: ["mpUserId", "email", "nickname", "connectedAt"],
  properties: {
    mpUserId: { type: "string" },
    email: { type: ["string", "null"] },
    nickname: { type: ["string", "null"] },
    connectedAt: { type: "string", format: "date-time" },
  },
} as const;

export const mpConnectStatusSchema = {
  tags: ["mp-connect"],
  summary: "Estado de la vinculación de Mercado Pago del usuario autenticado",
  description:
    "`linked`: vigente. `unlinked`: nunca vinculó o desvinculó a mano. `invalid`: revocada desde MP " +
    "o token vencido; se devuelve igual la cuenta. Nunca expone tokens.",
  response: {
    200: {
      type: "object",
      required: ["status", "account", "invalidReason"],
      properties: {
        status: { type: "string", enum: ["linked", "unlinked", "invalid"] },
        account,
        invalidReason: { type: ["string", "null"], enum: ["revoked", "expired", null] },
      },
    },
  },
} as const;

export const mpConnectAuthorizationUrlSchema = {
  tags: ["mp-connect"],
  summary: "URL de autorización de Mercado Pago (OAuth + PKCE S256, scope offline_access)",
  description:
    "La app la abre en un navegador embebido. `expiresAt` es el vencimiento del `state` guardado en Redis.",
  response: {
    200: {
      type: "object",
      required: ["authorizationUrl", "expiresAt"],
      properties: {
        authorizationUrl: { type: "string" },
        expiresAt: { type: "string", format: "date-time" },
      },
    },
    503: errorResponse,
  },
} as const;

export const mpConnectUnlinkSchema = {
  tags: ["mp-connect"],
  summary: "Desvincular la cuenta de Mercado Pago",
  description: "Idempotente: 204 aunque no haya nada vinculado. Después el status es `unlinked`.",
  response: {
    204: { type: "null" },
  },
} as const;

export const mpConnectCallbackSchema = {
  tags: ["mp-connect"],
  summary: "Callback de OAuth de Mercado Pago (público, sin JWT)",
  description:
    "Valida el `state`, canjea el `code` y persiste la cuenta. Siempre responde 302 a " +
    "`movo://mp-connect?result=success` o `?result=error&code=<MP_CONNECT_*|MP_ACCOUNT_ALREADY_LINKED>`.",
  querystring: {
    type: "object",
    properties: {
      code: { type: "string" },
      state: { type: "string" },
      error: { type: "string" },
    },
  },
  response: {
    302: { type: "null", description: "Redirect al deep link de la app" },
  },
} as const;
