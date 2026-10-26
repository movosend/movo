import type { AdminDisputeDetail, AdminDisputeRow } from "./admin-disputes";

/**
 * MOVO-343: lo que el panel necesita de las disputas y que `GET /admin/disputes*` de MOVO-337 todavía no devuelve.
 * Es una propuesta para MOVO-341 (lectura de disputas): el panel la consume en modo fixtures y, cuando `svc-admin` la
 * implemente, estos tipos se fusionan en `admin-disputes.ts` y este archivo se borra.
 */

/**
 * Filtros nuevos de `GET /admin/disputes`:
 * - `city`: coincidencia parcial, sin mayúsculas ni tildes, sobre el `pickupCity` del envío (igual que `MOVO-325`);
 *   `statusCounts` respeta el filtro.
 * - `sort`: `oldest` (más antigua primero, el orden del panel para abiertas) o `newest`. Hoy el listado es `newest`.
 */
export type AdminDisputeSort = "oldest" | "newest";

/** Cada fila trae la ciudad del retiro. */
export interface AdminDisputeRowPanel extends AdminDisputeRow {
  pickupCity: string | null;
}

/** Cuántas disputas abrió, perdió y tiene abiertas una parte (historial del expediente). */
export interface AdminDisputePartyHistory {
  userId: string;
  role: "sender" | "carrier" | "receiver";
  opened: number;
  lost: number;
  open: number;
}

/** Clasificación de DD-052 de una posición GPS contra el punto de retiro. */
export type AdminPickupEvidenceClass = "arrival" | "far" | "gray";

export interface AdminPickupEvidencePosition {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string;
  class: AdminPickupEvidenceClass;
}

/**
 * Disputas del sistema (`transit_anomaly`, `pickup_no_show`): no hay una parte que haya reclamado, así que el
 * expediente muestra a quién atribuyó el barrido y con qué datos.
 */
export interface AdminDisputeAttribution {
  reason: "transit_anomaly" | "pickup_no_show";
  /** A quién atribuyó el barrido; `null` si no pudo atribuir (sin evidencia suficiente). */
  attributedTo: "carrier" | "sender" | null;
  /** Una línea en castellano con la causa (la arma el backend con los datos de abajo). */
  summary: string;
  /** Cuándo corrió el barrido. */
  sweptAt: string;
  /** Evidencia pasiva de DD-052: vacía en `transit_anomaly`. */
  positions: AdminPickupEvidencePosition[];
  /** Último ping de `transit_anomaly`: dónde y cuándo se perdió la señal. */
  lastPingAt: string | null;
}

/** `GET /admin/disputes/:id`: el detalle de MOVO-337 más lo que falta (cada campo tolera backend viejo). */
export interface AdminDisputeDetailPanel extends AdminDisputeDetail {
  pickupCity: string | null;
  partyHistory: AdminDisputePartyHistory[];
  attribution: AdminDisputeAttribution | null;
}

/** Resumen mínimo para el detalle del envío (`AdminShipmentDetail.disputeId` deja de ser `null`). */
export interface AdminShipmentDisputeSummary {
  disputeId: string;
  status: AdminDisputeRow["status"];
  reason: AdminDisputeRow["reason"];
  openedByRole: AdminDisputeRow["openedByRole"];
  openedAt: string;
  statementsCount: number;
  /** Cuántas partes pueden descargar y ya lo hicieron: "1 de 2". */
  statementsExpected: number;
}

/** Agregado para el menú lateral y la home. */
export interface AdminDisputeCounters {
  open: number;
  resolving: number;
  /** Abiertas con más de 3 y más de 7 días. Sin semáforo hasta definir el plazo del descargo. */
  openOlderThan3Days: number;
  openOlderThan7Days: number;
}
