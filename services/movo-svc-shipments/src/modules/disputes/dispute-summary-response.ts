import { DISPUTE_OUTCOMES, DisputeReason } from "@movo/shared";

/**
 * Schema de respuesta del `DisputeSummary` de @movo/shared (motivo y quién abrió la disputa sin resolver), que suman
 * el detalle del viaje, `GET /shipments/:id` y `GET /offers/mine`. Una sola definición, con los motivos derivados del
 * enum (review PR #343): copiada en cada schema, un motivo nuevo obligaba a tocar tres lugares y el serializer lo
 * descartaba sin que fallara ningún chequeo de tipos. Va en un archivo propio, no en un `*.schema.ts`, para no romper
 * la regla de que esos schemas no importan unos de otros.
 */
export const disputeSummaryResponse = {
  type: ["object", "null"],
  required: ["id", "reason", "openedByRole", "openedAt"],
  properties: {
    id: { type: "string" },
    reason: { type: "string", enum: Object.values(DisputeReason) },
    openedByRole: { type: ["string", "null"], enum: ["sender", "receiver", "carrier", null] },
    openedAt: { type: "string", format: "date-time" },
  },
};

/** MOVO-363: schema del `ResolvedDisputeSummary` (`resolvedDisputes` de `GET /shipments/:id`). Sin montos (DD-056). */
export const resolvedDisputeSummaryResponse = {
  type: "object",
  required: ["id", "reason", "openedByRole", "openedAt", "outcome", "resolvedAt"],
  properties: {
    id: { type: "string" },
    reason: { type: "string", enum: Object.values(DisputeReason) },
    openedByRole: { type: ["string", "null"], enum: ["sender", "receiver", "carrier", null] },
    openedAt: { type: "string", format: "date-time" },
    outcome: { type: "string", enum: [...DISPUTE_OUTCOMES] },
    resolvedAt: { type: "string", format: "date-time" },
  },
};
