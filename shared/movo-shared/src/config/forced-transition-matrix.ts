import { ShipmentStatus } from "../types/shipment";

/**
 * MOVO-331 (ADR-055): matriz de cambios de estado de un envío hechos por un admin. Backend
 * (`svc-shipments` la valida) y panel (`movo-admin` decide qué ofrecer) la leen de acá: el panel
 * es solo ayuda visual, nunca la fuente de verdad.
 *
 * Una celda ausente es una transición BLOQUEADA. Los motivos de los bloqueos que el panel
 * muestra viven en `blockedTransitionReason`.
 */

/**
 * - `manual`: arista que ya existe en la máquina de estados, ejecutada por un admin con los
 *   mismos efectos que tiene para su actor normal.
 * - `forced`: el admin la ejecuta con un efecto distinto del camino normal (hoy: se condona la
 *   penalidad). Exige OTP nuevo.
 */
export type ForcedTransitionKind = "manual" | "forced";

export type ForcedTransitionRisk = "medium" | "high" | "critical";

/** Servicio de dominio que ejecuta la celda: sin servicio no hay celda. */
export type ForcedTransitionService =
  | "cancelShipment"
  | "withdrawCarrierFromShipment"
  | "confirmFunding"
  | "captureAndComplete";

export interface ForcedTransitionCell {
  kind: ForcedTransitionKind;
  risk: ForcedTransitionRisk;
  service: ForcedTransitionService;
}

type Row = Partial<Record<ShipmentStatus, ForcedTransitionCell>>;

const cancel = (risk: ForcedTransitionRisk, kind: ForcedTransitionKind = "manual"): ForcedTransitionCell => ({
  kind,
  risk,
  service: "cancelShipment",
});

const withdraw: ForcedTransitionCell = {
  kind: "forced",
  risk: "medium",
  service: "withdrawCarrierFromShipment",
};

const confirmFunding: ForcedTransitionCell = {
  kind: "manual",
  risk: "high",
  service: "confirmFunding",
};

export const FORCED_TRANSITION_MATRIX: Readonly<Record<ShipmentStatus, Row>> = {
  [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION]: {
    [ShipmentStatus.CANCELLED]: cancel("medium"),
  },
  [ShipmentStatus.PUBLISHED]: {
    [ShipmentStatus.CANCELLED]: cancel("medium"),
  },
  [ShipmentStatus.ASSIGNMENT_PENDING]: {
    [ShipmentStatus.PUBLISHED]: withdraw,
    [ShipmentStatus.ASSIGNED]: confirmFunding,
    [ShipmentStatus.CANCELLED]: cancel("high"),
  },
  [ShipmentStatus.ASSIGNED_UNFUNDED]: {
    [ShipmentStatus.PUBLISHED]: withdraw,
    [ShipmentStatus.ASSIGNED]: confirmFunding,
    [ShipmentStatus.CANCELLED]: cancel("high"),
  },
  [ShipmentStatus.ASSIGNED]: {
    [ShipmentStatus.PUBLISHED]: { ...withdraw, risk: "high" },
    [ShipmentStatus.CANCELLED]: cancel("high", "forced"),
  },
  [ShipmentStatus.IN_TRANSIT]: {},
  [ShipmentStatus.DELIVERED]: {
    [ShipmentStatus.COMPLETED]: {
      kind: "manual",
      risk: "critical",
      service: "captureAndComplete",
        },
  },
  [ShipmentStatus.REJECTED_BY_RECEIVER]: {
    [ShipmentStatus.CANCELLED]: cancel("medium"),
  },
  [ShipmentStatus.COMPLETED]: {},
  [ShipmentStatus.CANCELLED]: {},
  [ShipmentStatus.DISPUTED]: {},
};

export function getForcedTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
): ForcedTransitionCell | null {
  return FORCED_TRANSITION_MATRIX[from]?.[to] ?? null;
}

/** Destinos que el panel puede ofrecer desde `from`. */
export function listForcedTransitionTargets(from: ShipmentStatus): ShipmentStatus[] {
  return Object.keys(FORCED_TRANSITION_MATRIX[from] ?? {}) as ShipmentStatus[];
}

/** Por qué un par no se puede forzar (va en `details.reason` del 422 y en el tooltip del panel). */
export function blockedTransitionReason(from: ShipmentStatus, to: ShipmentStatus): string {
  if (from === ShipmentStatus.DISPUTED) {
    return "Un envío en disputa solo sale por la resolución de la disputa.";
  }
  if (from === ShipmentStatus.COMPLETED) {
    return "El pago de un envío completado ya se repartió: se corrige desde Pagos.";
  }
  if (from === ShipmentStatus.CANCELLED) {
    return "Un envío cancelado no se puede reabrir.";
  }
  if (to === ShipmentStatus.DISPUTED) {
    return "Una disputa se abre desde el flujo de disputas, con su expediente.";
  }
  if (to === ShipmentStatus.IN_TRANSIT || to === ShipmentStatus.DELIVERED) {
    return "El retiro y la entrega se confirman con el handshake: sin esa evidencia no se fuerzan.";
  }
  if (from === ShipmentStatus.IN_TRANSIT) {
    return "Un envío en tránsito solo avanza por la entrega o la disputa.";
  }
  return "No hay un servicio de dominio que ejecute esta transición.";
}
