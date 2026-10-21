// Schemas de /payments/cards (MOVO-100). Reflejan `types/saved-card.ts` de @movo/shared;
// el Swagger se genera desde acá.

const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        statusCode: { type: "number" },
        details: { type: "object", additionalProperties: true },
      },
    },
    requestId: { type: "string" },
  },
} as const;

const uuid = { type: "string", format: "uuid" } as const;

const savedCard = {
  type: "object",
  required: ["id", "mpCardId", "alias", "brand", "last4", "expMonth", "expYear", "issuerName", "paymentType", "isDefault", "createdAt"],
  properties: {
    id: uuid,
    mpCardId: { type: "string" },
    alias: { type: ["string", "null"] },
    brand: { type: "string" },
    last4: { type: "string" },
    expMonth: { type: "integer" },
    expYear: { type: "integer" },
    issuerName: { type: ["string", "null"] },
    paymentType: { type: ["string", "null"] },
    isDefault: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const cardIdParams = {
  type: "object",
  required: ["id"],
  properties: { id: uuid },
} as const;

// El largo real del alias (1-40 tras el trim) lo valida el service: un maxLength acá
// contaría los espacios sin recortar. Este tope solo evita bodies absurdos.
const aliasInput = { type: ["string", "null"], maxLength: 200 } as const;

export const cardsCheckoutDataSchema = {
  tags: ["cards"],
  summary: "public_key de Movo con la que se tokeniza la tarjeta al guardarla",
  response: {
    200: { type: "object", required: ["publicKey"], properties: { publicKey: { type: "string" } } },
    503: errorResponse,
  },
} as const;

export const createCardSchema = {
  tags: ["cards"],
  summary: "Guarda una tarjeta del emisor en su customer de la cuenta de Movo",
  description:
    "`cardToken` es de un solo uso, generado en el dispositivo con la `public_key` de `checkout-data`. " +
    "Una tarjeta repetida (misma marca, últimos 4 y vencimiento) responde 200 con la existente. " +
    "La primera tarjeta queda como predeterminada.",
  body: {
    type: "object",
    required: ["cardToken"],
    additionalProperties: false,
    properties: {
      cardToken: { type: "string", minLength: 1, maxLength: 200 },
      paymentMethodId: { type: "string", maxLength: 50 },
      alias: aliasInput,
    },
  },
  response: {
    200: savedCard,
    201: savedCard,
    400: errorResponse,
    409: errorResponse,
    422: errorResponse,
    502: errorResponse,
    503: errorResponse,
  },
} as const;

export const listCardsSchema = {
  tags: ["cards"],
  summary: "Tarjetas vivas del usuario autenticado",
  description: "Nunca devuelve número, CVV ni tokens. `mpCardId` no sirve para pagar sin el CVV.",
  response: { 200: { type: "array", items: savedCard } },
} as const;

export const setDefaultCardSchema = {
  tags: ["cards"],
  summary: "Marca una tarjeta como predeterminada (y desmarca la anterior)",
  params: cardIdParams,
  response: { 200: savedCard, 404: errorResponse },
} as const;

export const updateCardSchema = {
  tags: ["cards"],
  summary: "Edita el nombre de referencia (alias) de una tarjeta",
  description: "`alias: null` o vacío lo borra. 1-40 caracteres, sin una secuencia de 12+ dígitos.",
  params: cardIdParams,
  body: {
    type: "object",
    required: ["alias"],
    additionalProperties: false,
    properties: { alias: aliasInput },
  },
  response: { 200: savedCard, 400: errorResponse, 404: errorResponse },
} as const;

export const deleteCardSchema = {
  tags: ["cards"],
  summary: "Da de baja una tarjeta (en MP y localmente)",
  description: "409 `CARD_IN_USE` si tiene un hold vivo asociado. Si MP ya no la tenía, se da por borrada.",
  params: cardIdParams,
  response: { 204: { type: "null" }, 404: errorResponse, 409: errorResponse, 502: errorResponse },
} as const;

export const deleteUserCardsInternalSchema = {
  hide: true,
  params: {
    type: "object",
    required: ["userId"],
    properties: { userId: uuid },
  },
  response: { 204: { type: "null" } },
} as const;
