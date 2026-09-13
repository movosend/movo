import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router } from "expo-router";
import { shortAddressLabel } from "../lib/shipment-format";
import { useAuthStore } from "../store/auth-store";
import { useAttentionSourceShipments } from "./use-shipments";

export interface AttentionTask {
  id: string;
  title: string;
  meta: string;
  primaryLabel: string;
  onPrimary: () => void;
}

/**
 * "Requiere tu atención" (MOVO-193, alcance ampliado a pedido del usuario: reusar
 * todo lo que ya sirve el backend, crear tickets nuevos para lo que falte). Derivado
 * 100% de `GET /shipments/mine` — sin inventar ningún dato:
 *
 * - `AWAITING_RECEIVER_CONFIRMATION` con el usuario como receptor: tiene un envío
 *   para aceptar o rechazar.
 * - `REJECTED_BY_RECEIVER` con el usuario como emisor: el receptor rechazó el envío,
 *   hay que elegir otro.
 *
 * Deliberadamente fuera de esta versión (gaps de backend a crear como ticket nuevo,
 * ver el comentario dejado en MOVO-192):
 * - "Ofertas nuevas en mis envíos publicados": no hay ningún agregado de ofertas para
 *   el propio emisor en `GET /shipments/mine` — `ShipmentSummary.offersSummary` es
 *   solo para un transportista ajeno viendo el envío (MOVO-180), y listar el conteo
 *   real requeriría un `GET /shipments/:id/offers` por cada envío publicado (N+1).
 * - "Calificaciones pendientes de dar": no existe ningún endpoint que liste envíos
 *   entregados sin calificar por el usuario actual (`ratings-client.ts` solo permite
 *   crear/leer una calificación puntual).
 * - "Fondos pendientes de reservar" (`assigned_unfunded`): ya se comunica en la
 *   propia card de envío activo (`ActiveShipmentCard`), no se duplica acá como tarea.
 */
export function useAttentionTasks() {
  const { data, isLoading } = useAttentionSourceShipments();
  const currentUserId = useAuthStore((s) => s.user?.userId);

  const tasks: AttentionTask[] = [];
  if (data && currentUserId) {
    for (const shipment of data.items) {
      if (
        shipment.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
        shipment.receiverId === currentUserId
      ) {
        tasks.push({
          id: `confirm-${shipment.id}`,
          title: "Tenés un envío para confirmar",
          meta: shortAddressLabel(shipment.pickupAddress),
          primaryLabel: "Revisar",
          onPrimary: () => router.push(`/shipments/${shipment.id}`),
        });
      }
      if (
        shipment.status === ShipmentStatus.REJECTED_BY_RECEIVER &&
        shipment.senderId === currentUserId
      ) {
        tasks.push({
          id: `rejected-${shipment.id}`,
          title: "El receptor rechazó tu envío",
          meta: shortAddressLabel(shipment.deliveryAddress),
          primaryLabel: "Ver envío",
          onPrimary: () => router.push(`/shipments/${shipment.id}`),
        });
      }
    }
  }

  return { tasks, isLoading };
}
