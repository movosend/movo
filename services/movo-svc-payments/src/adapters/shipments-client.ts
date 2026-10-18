import type { HoldProviderEventRequest } from "@movo/shared";

/** Respuesta de `POST /internal/shipments/:id/hold-events` (MOVO-210 AC13). */
export interface HoldEventResult {
  handled: boolean;
  outcome: string;
}

export interface LedgerOrigin { id: string; label: string }

/** svc-shipments no respondió o devolvió un error que puede resolverse reintentando. */
export class ShipmentsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentsUnavailableError";
  }
}

/** svc-shipments no conoce el envío: reintentar no lo arregla. */
export class ShipmentNotFoundError extends Error {
  constructor() {
    super("svc-shipments no conoce el envío del hold");
    this.name = "ShipmentNotFoundError";
  }
}

/**
 * MOVO-268: única puerta de `svc-payments` hacia `svc-shipments`. Interno (ADR-010):
 * sin ruta en el gateway ni `x-user-id`, el caller es este servicio.
 */
export interface ShipmentsClient {
  /** Avisa que MP canceló, venció o rechazó un hold del envío. */
  notifyHoldEvent(shipmentId: string, event: HoldProviderEventRequest): Promise<HoldEventResult>;
  resolveLedgerOrigins(userId: string, shipmentIds: string[]): Promise<LedgerOrigin[]>;
}

const TIMEOUT_MS = 10_000;

export function createShipmentsClient(baseUrl: string): ShipmentsClient {
  return {
    async resolveLedgerOrigins(userId, shipmentIds) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/internal/ledger-origins`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, shipmentIds }),
          signal: AbortSignal.timeout(3_000),
        });
      } catch (error) {
        throw new ShipmentsUnavailableError(`no se pudo resolver el origen: ${String(error)}`);
      }
      if (!response.ok) throw new ShipmentsUnavailableError(`svc-shipments respondió ${response.status}`);
      const body: unknown = await response.json().catch(() => null);
      if (!Array.isArray(body) || !body.every((item) => item !== null && typeof item === "object" &&
        typeof item.id === "string" && typeof item.label === "string")) {
        throw new ShipmentsUnavailableError("svc-shipments devolvió orígenes inválidos");
      }
      return body as LedgerOrigin[];
    },
    async notifyHoldEvent(shipmentId, event) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/internal/shipments/${encodeURIComponent(shipmentId)}/hold-events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new ShipmentsUnavailableError(
          `no se pudo conectar con svc-shipments: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (response.status === 404) throw new ShipmentNotFoundError();
      if (!response.ok) throw new ShipmentsUnavailableError(`svc-shipments respondió ${response.status}`);

      const body = (await response.json().catch(() => null)) as Partial<HoldEventResult> | null;
      if (typeof body?.handled !== "boolean" || typeof body.outcome !== "string") {
        throw new ShipmentsUnavailableError("svc-shipments devolvió una respuesta inválida");
      }
      return { handled: body.handled, outcome: body.outcome };
    },
  };
}
