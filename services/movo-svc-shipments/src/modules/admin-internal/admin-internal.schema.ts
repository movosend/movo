// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
const uuid = { type: "string", format: "uuid" } as const;
const nullableUuid = { type: ["string", "null"], format: "uuid" } as const;

const SHIPMENT_STATUSES = [
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
] as const;
const TRIP_STATUSES = ["declared", "active", "cancelled", "expired", "completed"] as const;
const ROLES = ["sender", "carrier", "receiver"] as const;

// MOVO-294: secciones de la ficha del panel. Mismos topes que `svc-admin`, que es quien los expone.
const page = { type: "integer", minimum: 1, default: 1 } as const;
const pageSize = { type: "integer", minimum: 1, maximum: 50, default: 5 } as const;
const pageFields = { page: { type: "integer" }, pageSize: { type: "integer" } } as const;

const adminUserShipment = {
  type: "object",
  required: ["id", "shortId", "status", "pickupAddress", "deliveryAddress", "priceArs", "createdAt", "userRole", "senderId", "carrierId", "receiverId"],
  properties: {
    id: uuid,
    shortId: { type: "string" },
    status: { type: "string", enum: SHIPMENT_STATUSES },
    pickupAddress: { type: "string" },
    deliveryAddress: { type: "string" },
    priceArs: { type: ["number", "null"] },
    createdAt: { type: "string" },
    userRole: { type: "string", enum: ROLES },
    senderId: uuid,
    carrierId: nullableUuid,
    receiverId: uuid,
  },
} as const;

const adminUserTrip = {
  type: "object",
  required: ["id", "originAddress", "destinationAddress", "departureAt", "vehicleType", "status", "recurring"],
  properties: {
    id: uuid,
    originAddress: { type: "string" },
    destinationAddress: { type: "string" },
    departureAt: { type: "string" },
    vehicleType: { type: "string" },
    status: { type: "string", enum: TRIP_STATUSES },
    recurring: { type: "boolean" },
  },
} as const;

const adminUserRating = {
  type: "object",
  required: ["score", "comment", "raterId", "roleOfRated", "shipmentId", "createdAt"],
  properties: {
    score: { type: "integer" },
    comment: { type: ["string", "null"] },
    raterId: uuid,
    roleOfRated: { type: "string", enum: ROLES },
    shipmentId: uuid,
    createdAt: { type: "string" },
  },
} as const;

export const adminInternalSchemas = {
  listQuery: {
    type: "object",
    additionalProperties: false,
    properties: {
      group: { type: "string", enum: ["unassigned", "assigning", "in_progress", "closed", "disputes"] },
      status: { type: "string", enum: SHIPMENT_STATUSES },
      city: { type: "string", minLength: 1, maxLength: 100 },
      from: { type: "string", format: "date-time" },
      to: { type: "string", format: "date-time" },
      q: { type: "string", minLength: 1, maxLength: 100 },
      alert: { type: "boolean" },
      cursor: { type: "string", maxLength: 300 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
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

  idParam: {
    type: "object",
    required: ["id"],
    properties: { id: uuid },
  },

  shipmentPartiesResponse: {
    type: "object",
    required: ["shipmentId", "senderId", "carrierId", "receiverId", "formerReceiverIds"],
    properties: {
      shipmentId: uuid,
      senderId: uuid,
      carrierId: nullableUuid,
      receiverId: nullableUuid,
      formerReceiverIds: { type: "array", items: uuid },
    },
  },

  userShipmentsQuery: {
    type: "object",
    additionalProperties: false,
    properties: { role: { type: "string", enum: ROLES }, status: { type: "string", enum: SHIPMENT_STATUSES }, page, pageSize },
  },

  userShipmentsResponse: {
    type: "object",
    required: ["items", "page", "pageSize", "total", "counts"],
    properties: {
      items: { type: "array", items: adminUserShipment },
      ...pageFields,
      total: { type: "integer" },
      counts: {
        type: "object",
        required: ["sender", "carrier", "receiver"],
        properties: { sender: { type: "integer" }, carrier: { type: "integer" }, receiver: { type: "integer" } },
      },
    },
  },

  userTripsQuery: {
    type: "object",
    additionalProperties: false,
    properties: { status: { type: "string", enum: TRIP_STATUSES }, page, pageSize },
  },

  userTripsResponse: {
    type: "object",
    required: ["items", "page", "pageSize", "total"],
    properties: { items: { type: "array", items: adminUserTrip }, ...pageFields, total: { type: "integer" } },
  },

  userRatingsQuery: {
    type: "object",
    additionalProperties: false,
    properties: { page, pageSize },
  },

  userRatingsResponse: {
    type: "object",
    required: ["average", "count", "items", "page", "pageSize"],
    properties: {
      average: { type: ["number", "null"] },
      count: { type: "integer" },
      items: { type: "array", items: adminUserRating },
      ...pageFields,
    },
  },

  chatReportPartiesResponse: {
    type: "object",
    required: ["reportId", "shipmentId", "reporterId", "partyIds"],
    properties: {
      reportId: uuid,
      shipmentId: uuid,
      reporterId: uuid,
      partyIds: { type: "array", items: uuid },
    },
  },

  // MOVO-297: efectos de una sanción.
  inProgressShipmentsResponse: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "shortId", "status", "userRole", "pickupAddress", "deliveryAddress"],
      properties: {
        id: uuid,
        shortId: { type: "string" },
        status: { type: "string", enum: ["assignment_pending", "assigned_unfunded", "assigned", "in_transit"] },
        userRole: { type: "string", enum: ROLES },
        pickupAddress: { type: "string" },
        deliveryAddress: { type: "string" },
      },
    },
  },

  // MOVO-331 (ADR-055). Los topes del motivo son los de `@movo/shared` (`FORCE_STATUS_REASON_*`).
  forceStatusBody: {
    type: "object",
    additionalProperties: false,
    required: ["targetStatus", "expectedStatus", "reason", "adminId", "adminName", "idempotencyKey"],
    properties: {
      targetStatus: { type: "string", enum: SHIPMENT_STATUSES },
      expectedStatus: { type: "string", enum: SHIPMENT_STATUSES },
      reason: { type: "string", minLength: 20, maxLength: 500 },
      adminId: uuid,
      adminName: { type: "string", minLength: 1, maxLength: 200 },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 128 },
    },
  },

  forceStatusResponse: {
    type: "object",
    required: ["shipmentId", "fromStatus", "toStatus", "kind", "replayed"],
    properties: {
      shipmentId: uuid,
      fromStatus: { type: "string", enum: SHIPMENT_STATUSES },
      toStatus: { type: "string", enum: SHIPMENT_STATUSES },
      kind: { type: "string", enum: ["manual", "forced"] },
      replayed: { type: "boolean" },
    },
  },

  // `sanctionId` es opcional: con él, volver a sancionar tras levantar la sanción vuelve a avisar a las contrapartes.
  withdrawOpenActivityBody: {
    type: ["object", "null"],
    additionalProperties: false,
    properties: { sanctionId: uuid },
  },

  withdrawOpenActivityResponse: {
    type: "object",
    required: [
      "cancelledShipmentIds",
      "withdrawnOfferIds",
      "cancelledTripIds",
      "stoppedRecurrenceTripIds",
      "notifiedCounterpartyCount",
      "failures",
    ],
    properties: {
      cancelledShipmentIds: { type: "array", items: uuid },
      withdrawnOfferIds: { type: "array", items: uuid },
      cancelledTripIds: { type: "array", items: uuid },
      stoppedRecurrenceTripIds: { type: "array", items: uuid },
      notifiedCounterpartyCount: { type: "integer" },
      failures: {
        type: "array",
        items: {
          type: "object",
          required: ["kind", "id"],
          properties: { kind: { type: "string", enum: ["shipment", "offer", "trip", "series"] }, id: uuid },
        },
      },
    },
  },
};
