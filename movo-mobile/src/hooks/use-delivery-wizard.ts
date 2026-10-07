import { useAuthStore } from "../store/auth-store";
import { useEvidenceStatus, useShipment } from "./use-shipments";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentSummary } from "../api/shipments-client";

export type DeliveryWizardGate =
  | "loading"
  | "not_found"
  | "not_carrier"
  | "already_done"
  | "invalid_state"
  | "ready";

export interface DeliveryWizardState {
  gate: DeliveryWizardGate;
  shipment: ShipmentSummary | undefined;
}

/**
 * Gate del wizard de entrega (MOVO-199, calcado de `usePickupWizard` MOVO-198 AC1):
 * resuelve, antes de que `delivery/_layout.tsx` renderice el `<Stack>` de sus pasos,
 * si el envío está realmente en condiciones de iniciar la entrega. `in_transit` es
 * el único caso real ("ready") -- el resto son estados que un deep link manual (el
 * único punto de entrada hoy, cableado desde el mapa de ruta de MOVO-207) puede
 * alcanzar y que el wizard tiene que explicar, no tratar como un error genérico.
 *
 * A diferencia de pickup no hay un caso especial tipo `unfunded`: no existe un
 * estado intermedio equivalente del lado de entrega (`assigned`/`assigned_unfunded`
 * caen directo a `invalid_state`, igual que cualquier otro estado que no sea
 * `in_transit`/`delivered`/`completed`).
 */
export function useDeliveryWizard(shipmentId: string | undefined) {
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const { data: shipment, isLoading, isError } = useShipment(shipmentId);
  const evidenceStatus = useEvidenceStatus(shipmentId);

  let gate: DeliveryWizardGate = "loading";
  if (!isLoading) {
    if (isError || !shipment) {
      gate = "not_found";
    } else if (shipment.carrierId !== currentUserId) {
      gate = "not_carrier";
    } else if (shipment.status === ShipmentStatus.IN_TRANSIT) {
      gate = "ready";
    } else if (shipment.status === ShipmentStatus.DELIVERED || shipment.status === ShipmentStatus.COMPLETED) {
      gate = "already_done";
    } else {
      gate = "invalid_state";
    }
  }

  return { gate, shipment, evidenceStatus };
}
