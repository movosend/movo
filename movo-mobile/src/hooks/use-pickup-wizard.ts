import { useAuthStore } from "../store/auth-store";
import { useEvidenceStatus, useShipment } from "./use-shipments";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentSummary } from "../api/shipments-client";

export type PickupWizardGate =
  | "loading"
  | "not_found"
  | "not_carrier"
  | "unfunded"
  | "already_done"
  | "invalid_state"
  | "ready";

export interface PickupWizardState {
  gate: PickupWizardGate;
  shipment: ShipmentSummary | undefined;
}

/**
 * Gate del wizard de retiro (MOVO-198 AC1): resuelve, antes de que
 * `pickup/_layout.tsx` renderice el `<Stack>` de sus 4 pasos, si el envío está
 * realmente en condiciones de iniciar el retiro. `assigned` es el único caso real
 * ("ready") -- el resto son estados que un deep link manual (el único punto de
 * entrada hoy, sin CTA real de MOVO-207 todavía) puede alcanzar y que el wizard
 * tiene que explicar, no tratar como un error genérico.
 */
export function usePickupWizard(shipmentId: string | undefined) {
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const { data: shipment, isLoading, isError } = useShipment(shipmentId);
  const evidenceStatus = useEvidenceStatus(shipmentId);

  let gate: PickupWizardGate = "loading";
  if (!isLoading) {
    if (isError || !shipment) {
      gate = "not_found";
    } else if (shipment.carrierId !== currentUserId) {
      gate = "not_carrier";
    } else if (shipment.status === ShipmentStatus.ASSIGNED_UNFUNDED) {
      gate = "unfunded";
    } else if (shipment.status === ShipmentStatus.ASSIGNED) {
      gate = "ready";
    } else if (shipment.status === ShipmentStatus.IN_TRANSIT) {
      gate = "already_done";
    } else {
      gate = "invalid_state";
    }
  }

  return { gate, shipment, evidenceStatus };
}
