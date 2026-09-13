import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router } from "expo-router";
import { receiverConfirmationDeadlineShortLabel, shortAddressLabel } from "../lib/shipment-format";
import { useAuthStore } from "../store/auth-store";
import { usePublicProfiles } from "./use-profile";
import { useAttentionSourceShipments } from "./use-shipments";

/** Tarea informativa de un solo botón (ej. "El receptor rechazó tu envío"). */
export interface AttentionInfoTask {
  kind: "info";
  id: string;
  title: string;
  meta: string;
  onPress: () => void;
  primaryLabel: string;
  onPrimary: () => void;
}

/** Tarea de confirmación de un envío recibido — se renderiza con
 * `AttentionConfirmCard`, que dispara los mismos sheets de aceptar/rechazar que la
 * pantalla de detalle (`ShipmentConfirmationSheets`, MOVO-131/193) en vez de navegar. */
export interface AttentionConfirmTask {
  kind: "confirm";
  id: string;
  shipmentId: string;
  senderFirstName?: string;
  title: string;
  meta: string;
  onPress: () => void;
}

export type AttentionTask = AttentionInfoTask | AttentionConfirmTask;

/**
 * "Requiere tu atención" (MOVO-193, alcance ampliado a pedido del usuario: reusar
 * todo lo que ya sirve el backend, crear tickets nuevos para lo que falte). Derivado
 * 100% de `GET /shipments/mine` — sin inventar ningún dato:
 *
 * - `AWAITING_RECEIVER_CONFIRMATION` con el usuario como receptor: tiene un envío
 *   para aceptar o rechazar. Tocar la card navega al detalle; los botones de
 *   Aceptar/Rechazar (renderizados por `AttentionConfirmCard`) abren el sheet real
 *   de confirmación en vez de resolverlo acá con un `Alert` genérico — feedback
 *   explícito del usuario tras una primera versión con `Alert.alert`.
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
 *   crear/leer una calificación puntual) — ver `MOVO-222`.
 * - "Fondos pendientes de reservar" (`assigned_unfunded`): ya se comunica en la
 *   propia card de envío activo (`ActiveShipmentCard`), no se duplica acá como tarea.
 */
export function useAttentionTasks() {
  const { data, isLoading } = useAttentionSourceShipments();
  const currentUserId = useAuthStore((s) => s.user?.userId);

  const confirmSenderIds = Array.from(
    new Set(
      (data?.items ?? [])
        .filter(
          (shipment) =>
            shipment.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
            shipment.receiverId === currentUserId,
        )
        .map((shipment) => shipment.senderId),
    ),
  );
  const senderProfiles = usePublicProfiles(confirmSenderIds);
  const senderFirstNameById = new Map(
    confirmSenderIds.map((id, index) => [
      id,
      senderProfiles[index]?.data?.fullName.split(" ")[0],
    ]),
  );

  const tasks: AttentionTask[] = [];
  if (data && currentUserId) {
    for (const shipment of data.items) {
      if (
        shipment.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
        shipment.receiverId === currentUserId
      ) {
        const senderFirstName = senderFirstNameById.get(shipment.senderId);
        const deadlineLabel = receiverConfirmationDeadlineShortLabel(
          shipment.receiverConfirmationDeadline,
        );
        tasks.push({
          kind: "confirm",
          id: `confirm-${shipment.id}`,
          shipmentId: shipment.id,
          senderFirstName,
          title: senderFirstName
            ? `${senderFirstName} te quiere enviar un paquete`
            : "Tenés un envío para confirmar",
          meta: deadlineLabel
            ? `Recibís en ${shortAddressLabel(shipment.pickupAddress)} · ${deadlineLabel}`
            : `Recibís en ${shortAddressLabel(shipment.pickupAddress)}`,
          onPress: () => router.push(`/shipments/${shipment.id}`),
        });
      }
      if (
        shipment.status === ShipmentStatus.REJECTED_BY_RECEIVER &&
        shipment.senderId === currentUserId
      ) {
        tasks.push({
          kind: "info",
          id: `rejected-${shipment.id}`,
          title: "El receptor rechazó tu envío",
          meta: shortAddressLabel(shipment.deliveryAddress),
          onPress: () => router.push(`/shipments/${shipment.id}`),
          primaryLabel: "Ver envío",
          onPrimary: () => router.push(`/shipments/${shipment.id}`),
        });
      }
    }
  }

  return { tasks, isLoading };
}
