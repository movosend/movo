import { ShipmentStatus } from "../types/shipment";

/**
 * MOVO-331 (DD-055): matriz de cambios de estado de un envío hechos por un admin. Backend
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

export type ForcedTransitionRecipient = "sender" | "receiver" | "carrier";

/** Estados en los que el envío tiene un transportista asignado (y por lo tanto un hold). */
const STATUSES_WITH_CARRIER: readonly ShipmentStatus[] = [
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELIVERED,
];

/** Lo que el panel muestra antes de confirmar (DD-055): qué se ejecuta y a quién se avisa. */
export interface ForcedTransitionDetails extends ForcedTransitionCell {
  /** Qué hace la transición, en el orden en que ocurre. */
  effects: string[];
  /** Quién recibe el aviso (siempre crítico y sin monto). El transportista solo si el envío tiene uno. */
  notifies: ForcedTransitionRecipient[];
  /** Qué conviene verificar ANTES de confirmar (el backend igual lo valida si es un hecho externo). */
  checks: string[];
  /** Qué no se puede deshacer una vez hecho. */
  irreversible: string[];
}

function effectsOf(from: ShipmentStatus, to: ShipmentStatus, cell: ForcedTransitionCell): string[] {
  const hasCarrier = STATUSES_WITH_CARRIER.includes(from);
  switch (cell.service) {
    case "cancelShipment":
      return [
        hasCarrier ? "Libera el hold del pago." : "Cierra las ofertas pendientes del envío.",
        "El envío queda cancelado y no se puede reabrir.",
        ...(from === ShipmentStatus.ASSIGNED ? ["Sin penalidad para el emisor ni deuda para el transportista."] : []),
      ];
    case "withdrawCarrierFromShipment":
      return [
        "Libera el hold del pago.",
        "Desasigna al transportista y restaura la ventana de retiro original.",
        "El envío vuelve a estar publicado para otros transportistas.",
        "Sin penalidad para el transportista.",
      ];
    case "confirmFunding":
      return [
        "Verifica en Mercado Pago que el hold esté autorizado: si no lo está, no se cambia nada.",
        "Cierra las ofertas pendientes de otros transportistas.",
      ];
    case "captureAndComplete":
      return [
        "Captura el hold y acredita el pago al transportista.",
        "El envío queda completado.",
      ];
    default: {
      const exhaustive: never = cell.service;
      return exhaustive;
    }
  }
}

function checksOf(cell: ForcedTransitionCell): string[] {
  switch (cell.service) {
    case "confirmFunding":
      return ["Confirmá en Mercado Pago que el hold está autorizado. Si no lo está, el sistema rechaza el cambio."];
    case "captureAndComplete":
      return ["Confirmá que el paquete llegó a destino: la captura del pago no se revierte sola."];
    default:
      return [];
  }
}

function irreversibleOf(from: ShipmentStatus, to: ShipmentStatus, cell: ForcedTransitionCell): string[] {
  switch (cell.service) {
    case "cancelShipment":
      return ["Un envío cancelado es terminal: no se reabre. Para retomarlo, el emisor tiene que crear uno nuevo."];
    case "withdrawCarrierFromShipment":
      return ["El transportista pierde el envío. Para recuperarlo tiene que volver a ofertar."];
    case "captureAndComplete":
      return ["Una vez capturado el pago, revertirlo pide un reembolso manual desde Pagos."];
    case "confirmFunding":
      return to === ShipmentStatus.ASSIGNED && from !== ShipmentStatus.ASSIGNED
        ? ["Se cierran las ofertas pendientes de otros transportistas: no vuelven a abrirse solas."]
        : [];
    default: {
      const exhaustive: never = cell.service;
      return exhaustive;
    }
  }
}

/** Celda + efectos + destinatarios del aviso. `null` si el par está bloqueado. */
export function getForcedTransitionDetails(from: ShipmentStatus, to: ShipmentStatus): ForcedTransitionDetails | null {
  const cell = getForcedTransition(from, to);
  if (!cell) return null;
  return {
    ...cell,
    effects: effectsOf(from, to, cell),
    notifies: STATUSES_WITH_CARRIER.includes(from) ? ["sender", "receiver", "carrier"] : ["sender", "receiver"],
    checks: checksOf(cell),
    irreversible: irreversibleOf(from, to, cell),
  };
}

/**
 * Fricción que exige la celda (DD-055). El código del envío tipeado, desde riesgo alto; el segundo
 * factor (OTP por acción), si la transición es forzada o el riesgo es crítico.
 */
export function forcedTransitionFriction(cell: ForcedTransitionCell): { typedCode: boolean; stepUp: boolean } {
  return {
    typedCode: cell.risk === "high" || cell.risk === "critical",
    stepUp: cell.kind === "forced" || cell.risk === "critical",
  };
}
