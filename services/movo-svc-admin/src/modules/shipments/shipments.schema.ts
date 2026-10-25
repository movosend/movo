import { FORCE_STATUS_REASON_MAX_LENGTH } from "@movo/shared";

const errorResponse = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "statusCode"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        statusCode: { type: "integer" },
        // MOVO-332: el panel explica `STATUS_CHANGED` (`currentStatus`) y `TRANSITION_NOT_ALLOWED` (`reason`) con esto.
        details: { type: "object", additionalProperties: true },
      },
    },
    requestId: { type: "string" },
  },
};

const shipmentStatuses = [
  "awaiting_receiver_confirmation",
  "rejected_by_receiver",
  "published",
  "assignment_pending",
  "assigned_unfunded",
  "assigned",
  "in_transit",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
];
const chatRoles = ["sender", "carrier", "receiver"];

const partyRef = {
  type: "object",
  required: ["id", "name"],
  properties: { id: { type: "string" }, name: { type: ["string", "null"] } },
};

const shipmentRow = {
  type: "object",
  required: [
    "id",
    "code",
    "status",
    "sender",
    "carrier",
    "receiver",
    "pickupCity",
    "pickupAddress",
    "deliveryCity",
    "deliveryAddress",
    "pickupDate",
    "pickupTimeWindowStart",
    "pickupTimeWindowEnd",
    "priceArs",
    "priceKind",
    "lastStatusChangeAt",
    "delayed",
    "disputeId",
    "fundingDeadline",
    "redesignationDeadline",
  ],
  properties: {
    id: { type: "string" },
    code: { type: "string", description: "Primeros 8 caracteres del id, como el '#' de la app." },
    status: { type: "string", enum: shipmentStatuses },
    sender: partyRef,
    carrier: { anyOf: [partyRef, { type: "null" }] },
    receiver: partyRef,
    pickupCity: { type: ["string", "null"] },
    pickupAddress: { type: "string" },
    deliveryCity: { type: ["string", "null"] },
    deliveryAddress: { type: "string" },
    pickupDate: { type: "string", description: "YYYY-MM-DD" },
    pickupTimeWindowStart: { type: "string", description: "HH:MM" },
    pickupTimeWindowEnd: { type: "string", description: "HH:MM" },
    priceArs: { type: ["number", "null"] },
    priceKind: { type: ["string", "null"], enum: ["agreed", "suggested", null] },
    lastStatusChangeAt: { type: "string" },
    delayed: { type: "boolean" },
    disputeId: { type: ["string", "null"] },
    fundingDeadline: { type: ["string", "null"] },
    redesignationDeadline: { type: ["string", "null"] },
  },
};

const counts = {
  type: "object",
  required: ["all", "unassigned", "assigning", "in_progress", "closed", "disputes"],
  properties: {
    all: { type: "integer", description: "Envíos activos." },
    unassigned: { type: "integer" },
    assigning: { type: "integer" },
    in_progress: { type: "integer" },
    closed: { type: "integer" },
    disputes: { type: "integer" },
  },
};

const statusCounts = {
  type: "object",
  description: "Conteo de cada estado con los mismos filtros, para los chips de una pestaña.",
  required: shipmentStatuses,
  properties: Object.fromEntries(shipmentStatuses.map((status) => [status, { type: "integer" }])),
};

const errorOf = {
  type: "object",
  required: ["code", "message"],
  properties: { code: { type: "string" }, message: { type: "string" } },
};

/** Un bloque del detalle: `{ data, error: null }` o `{ data: null, error }`. */
const block = (data: object) => ({
  type: "object",
  required: ["data", "error"],
  properties: { data: { anyOf: [data, { type: "null" }] }, error: { anyOf: [errorOf, { type: "null" }] } },
});

/** Hold de svc-payments (`HoldDetailResponse`): lista cerrada para que un campo nuevo no llegue al panel sin querer. */
const payment = {
  type: "object",
  description: "Hold de svc-payments; null si nunca se intentó el pago.",
  required: ["status"],
  properties: {
    id: { type: "string" },
    shipmentId: { type: "string" },
    carrierId: { type: "string" },
    attempt: { type: "integer" },
    mpPaymentId: { type: ["string", "null"] },
    baseAmountArs: { type: "number" },
    debtOffsetArs: { type: "number" },
    debtSurchargeArs: { type: "number" },
    amountArs: { type: "number" },
    applicationFeeArs: { type: "number" },
    commissionArs: { type: "number" },
    status: { type: "string" },
    statusDetail: { type: ["string", "null"] },
    failureReason: { type: ["string", "null"] },
    expiresAt: { type: ["string", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    wasAuthorized: { type: "boolean" },
    cardBrand: { type: ["string", "null"] },
    cardLast4: { type: ["string", "null"] },
  },
};
const event = {
  type: "object",
  required: ["id", "fromStatus", "toStatus", "actorId", "reason", "createdAt"],
  properties: {
    id: { type: "string" },
    fromStatus: { type: ["string", "null"] },
    toStatus: { type: "string" },
    actorId: { type: ["string", "null"] },
    // MOVO-333: quién y cómo originó el cambio. Sin declararlos Fastify los recorta y el panel no distingue un
    // cambio de admin de uno normal.
    actorName: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
    kind: { type: "string", enum: ["normal", "manual", "forced"] },
    createdAt: { type: "string" },
  },
};
const photo = {
  type: "object",
  required: ["id", "stage", "url", "createdAt"],
  properties: {
    id: { type: "string" },
    stage: { type: "string", enum: ["creation", "pickup", "delivery"] },
    url: { type: "string", description: "URL firmada de vida corta." },
    createdAt: { type: "string" },
  },
};
const nullableString = { type: ["string", "null"] };
const offer = {
  type: "object",
  required: [
    "id",
    "carrierId",
    "carrierName",
    "carrierRatingAtOffer",
    "status",
    "priceArs",
    "netArs",
    "commissionArs",
    "commissionRate",
    "mpFeeEstimateArs",
    "receivedEstimateArs",
    "offeredDate",
    "pickupTimeWindowStart",
    "pickupTimeWindowEnd",
    "estimatedDeliveryDate",
    "estimatedDeliveryTimeWindowStart",
    "estimatedDeliveryTimeWindowEnd",
    "message",
    "tripId",
    "createdAt",
    "viewedAtBySender",
    "respondedAt",
    "expiresAt",
  ],
  properties: {
    id: { type: "string" },
    carrierId: { type: "string" },
    carrierName: { ...nullableString, description: "Snapshot al momento de ofertar." },
    carrierRatingAtOffer: { type: ["number", "null"], description: "Snapshot al momento de ofertar." },
    status: { type: "string", description: "Estado efectivo: una `pending` vencida viene como `expired`." },
    priceArs: { type: "number", description: "Bruto: lo que paga el emisor." },
    netArs: { type: "number" },
    commissionArs: { type: "number" },
    commissionRate: { type: "number", description: "Tasa de Movo del desglose (la vigente al leer)." },
    mpFeeEstimateArs: { type: "number", description: "Estimado (MOVO-225), no el monto real del pago." },
    receivedEstimateArs: { type: "number" },
    offeredDate: { type: "string", description: "`YYYY-MM-DD` del retiro propuesto." },
    pickupTimeWindowStart: { ...nullableString, description: "`HH:MM`; `null` = la franja que pidió el emisor." },
    pickupTimeWindowEnd: nullableString,
    estimatedDeliveryDate: nullableString,
    estimatedDeliveryTimeWindowStart: nullableString,
    estimatedDeliveryTimeWindowEnd: nullableString,
    message: nullableString,
    tripId: nullableString,
    createdAt: { type: "string" },
    viewedAtBySender: nullableString,
    respondedAt: nullableString,
    expiresAt: nullableString,
  },
};
const partyCard = {
  type: "object",
  required: [
    "id",
    "role",
    "fullName",
    "photoUrl",
    "accountStatus",
    "identityVerified",
    "licenseVerified",
    "reputationScore",
    "ratingCount",
  ],
  properties: {
    id: { type: "string" },
    role: { type: "string", enum: chatRoles },
    fullName: { type: "string" },
    photoUrl: { type: ["string", "null"] },
    accountStatus: { type: "string", enum: ["active", "suspended", "banned", "deleted"] },
    identityVerified: { type: "boolean" },
    licenseVerified: { type: "boolean" },
    reputationScore: { type: ["number", "null"] },
    ratingCount: { type: "integer" },
  },
};

// MOVO-327: seguimiento del envío para el mapa.
const trackingPlace = {
  type: "object",
  required: ["lat", "lng", "label"],
  properties: { lat: { type: "number" }, lng: { type: "number" }, label: { type: "string" } },
};
const nullableNumber = { type: ["number", "null"] };

const trackingResponse = {
  type: "object",
  required: [
    "shipmentId",
    "shipmentStatus",
    "state",
    "reason",
    "origin",
    "destination",
    "plannedRoute",
    "trace",
    "traceTruncated",
    "traceAvailable",
    "lastPosition",
    "lastPingAt",
    "signalLost",
    "delayed",
    "metrics",
    "serverTime",
    "pollIntervalSeconds",
  ],
  properties: {
    shipmentId: { type: "string" },
    shipmentStatus: { type: "string", enum: shipmentStatuses },
    state: {
      type: "string",
      enum: ["not_started", "live", "closed", "no_carrier"],
      description: "`live` en camino (con posición); `closed` con la traza guardada; `not_started` sin retiro; `no_carrier` sin transportista.",
    },
    reason: {
      type: ["string", "null"],
      enum: ["awaiting_pickup", "unfunded", "delivered", "completed", "disputed", "cancelled", "no_carrier", null],
    },
    origin: trackingPlace,
    destination: trackingPlace,
    plannedRoute: {
      type: ["object", "null"],
      required: ["polyline", "distanceMeters", "durationSeconds"],
      description: "Polyline encoded de Google (5 decimales). `null` sin transportista o si el proveedor de rutas falló.",
      properties: {
        polyline: { type: "string" },
        distanceMeters: { type: "number" },
        durationSeconds: { type: "number" },
      },
    },
    trace: {
      type: "array",
      description: "Cronológica, del retiro a la entrega (o a ahora). Hasta 500 puntos.",
      items: {
        type: "object",
        required: ["lat", "lng", "capturedAt"],
        properties: { lat: { type: "number" }, lng: { type: "number" }, capturedAt: { type: "string" } },
      },
    },
    traceTruncated: { type: "boolean", description: "Pasó el tope y se submuestreó, con el primer y el último punto." },
    traceAvailable: { type: "boolean", description: "`false` sin puntos: sin retiro o purgada por retención (DD-023)." },
    lastPosition: {
      type: ["object", "null"],
      required: ["lat", "lng", "accuracyM", "capturedAt"],
      description: "Solo con `live`.",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
        accuracyM: nullableNumber,
        capturedAt: { type: "string" },
      },
    },
    lastPingAt: { type: ["string", "null"], description: "Hora del servidor al recibir el último ping." },
    signalLost: { type: "boolean" },
    delayed: { type: "boolean", description: "En camino con la anomalía de `in_transit` marcada (DD-045)." },
    metrics: {
      type: ["object", "null"],
      required: ["avgSpeedKmh5m", "remainingMeters", "progressPct", "etaAt"],
      description: "Solo con `live`. Sin señal, `avgSpeedKmh5m` y `etaAt` en `null`.",
      properties: {
        avgSpeedKmh5m: nullableNumber,
        remainingMeters: nullableNumber,
        progressPct: nullableNumber,
        etaAt: { type: ["string", "null"] },
      },
    },
    serverTime: { type: "string" },
    pollIntervalSeconds: { type: "integer" },
  },
};

export const shipmentsSchemas = {
  errorResponse,
  trackingResponse,
  listQuery: {
    type: "object",
    additionalProperties: false,
    properties: {
      group: { type: "string", enum: ["unassigned", "assigning", "in_progress", "closed", "disputes"] },
      status: { type: "string", enum: shipmentStatuses },
      city: { type: "string", minLength: 1, maxLength: 100 },
      from: { type: "string", format: "date-time" },
      to: { type: "string", format: "date-time" },
      q: { type: "string", minLength: 1, maxLength: 100 },
      alert: { type: "boolean", description: "Solo los que llevan aviso (`isAdminShipmentAlert`)." },
      cursor: { type: "string", maxLength: 300 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  listResponse: {
    type: "object",
    required: ["items", "nextCursor", "counts", "statusCounts", "alertCounts"],
    properties: {
      items: { type: "array", items: shipmentRow },
      nextCursor: { type: ["string", "null"] },
      counts,
      statusCounts,
      alertCounts: { ...counts, description: "De cada pestaña, cuántos llevan aviso." },
    },
  },
  idParam: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },

  // MOVO-332: cambio de estado desde el panel (DD-055). El largo mínimo del motivo y el código tipeado se
  // validan dentro de la acción, no acá: así un rechazo por forma también queda en la bitácora.
  statusChangeBody: {
    type: "object",
    additionalProperties: false,
    required: ["targetStatus", "expectedStatus", "reason", "idempotencyKey"],
    properties: {
      targetStatus: { type: "string", enum: shipmentStatuses },
      expectedStatus: { type: "string", enum: shipmentStatuses },
      reason: { type: "string", minLength: 1, maxLength: FORCE_STATUS_REASON_MAX_LENGTH },
      typedCode: { type: "string", maxLength: 32 },
      stepUpToken: { type: "string", minLength: 20, maxLength: 128 },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 128 },
    },
  },
  statusChangeResponse: {
    type: "object",
    required: ["shipmentId", "fromStatus", "toStatus", "kind", "replayed"],
    properties: {
      shipmentId: { type: "string" },
      fromStatus: { type: "string", enum: shipmentStatuses },
      toStatus: { type: "string", enum: shipmentStatuses },
      kind: { type: "string", enum: ["manual", "forced"] },
      replayed: { type: "boolean" },
    },
  },
  statusOptionsResponse: {
    type: "object",
    required: ["current", "code", "options", "blocked"],
    properties: {
      current: { type: "string", enum: shipmentStatuses },
      code: { type: "string" },
      options: {
        type: "array",
        items: {
          type: "object",
          required: [
            "targetStatus",
            "kind",
            "risk",
            "effects",
            "notifies",
            "checks",
            "irreversible",
            "requiresTypedCode",
            "requiresStepUp",
          ],
          properties: {
            targetStatus: { type: "string", enum: shipmentStatuses },
            kind: { type: "string", enum: ["manual", "forced"] },
            risk: { type: "string", enum: ["medium", "high", "critical"] },
            effects: { type: "array", items: { type: "string" } },
            notifies: { type: "array", items: { type: "string", enum: chatRoles } },
            checks: { type: "array", items: { type: "string" } },
            irreversible: { type: "array", items: { type: "string" } },
            requiresTypedCode: { type: "boolean" },
            requiresStepUp: { type: "boolean" },
          },
        },
      },
      blocked: {
        type: "array",
        items: {
          type: "object",
          required: ["targetStatus", "reason"],
          properties: { targetStatus: { type: "string", enum: shipmentStatuses }, reason: { type: "string" } },
        },
      },
    },
  },
  stepUpBody: {
    type: "object",
    additionalProperties: false,
    required: ["shipmentId", "targetStatus"],
    properties: { shipmentId: { type: "string", format: "uuid" }, targetStatus: { type: "string", enum: shipmentStatuses } },
  },
  stepUpChallengeResponse: {
    type: "object",
    required: ["challengeId", "maskedEmail", "cooldownSeconds", "expiresInSeconds"],
    properties: {
      challengeId: { type: "string" },
      maskedEmail: { type: "string" },
      cooldownSeconds: { type: "integer" },
      expiresInSeconds: { type: "integer" },
    },
  },
  stepUpVerifyBody: {
    type: "object",
    additionalProperties: false,
    required: ["shipmentId", "targetStatus", "challengeId", "code"],
    properties: {
      shipmentId: { type: "string", format: "uuid" },
      targetStatus: { type: "string", enum: shipmentStatuses },
      challengeId: { type: "string", minLength: 1, maxLength: 128 },
      code: { type: "string", pattern: "^[0-9]{6}$" },
    },
  },
  stepUpTokenResponse: {
    type: "object",
    required: ["stepUpToken", "expiresInSeconds"],
    properties: { stepUpToken: { type: "string" }, expiresInSeconds: { type: "integer" } },
  },
  detailResponse: {
    type: "object",
    required: ["shipment", "events", "photos", "offers", "payment", "parties"],
    properties: {
      shipment: { ...shipmentRow, additionalProperties: true },
      events: block({ type: "array", items: event }),
      photos: block({ type: "array", items: photo }),
      offers: block({ type: "array", items: offer }),
      payment: block(payment),
      parties: block({ type: "array", items: partyCard }),
    },
  },
  chatQuery: {
    type: "object",
    additionalProperties: false,
    properties: {
      cursor: { type: "string", maxLength: 300 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  chatResponse: {
    type: "object",
    required: ["items", "nextCursor", "partiesAccess", "archived", "reports", "events"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "authorId", "authorName", "authorRole", "body", "moderated", "createdAt"],
          properties: {
            id: { type: "string" },
            authorId: { type: "string" },
            authorName: { type: ["string", "null"] },
            authorRole: { type: ["string", "null"], enum: [...chatRoles, null] },
            body: { type: "string" },
            moderated: { type: "boolean" },
            createdAt: { type: "string" },
          },
        },
      },
      nextCursor: { type: ["string", "null"] },
      partiesAccess: { type: "string", enum: ["open", "read_only", "closed"] },
      archived: { type: "boolean" },
      reports: {
        type: "array",
        items: {
          type: "object",
          required: ["reporterId", "reporterRole", "createdAt"],
          properties: {
            reporterId: { type: "string" },
            reporterRole: { type: ["string", "null"], enum: [...chatRoles, null] },
            createdAt: { type: "string" },
          },
        },
      },
      events: { type: "array", items: event },
    },
  },
};
