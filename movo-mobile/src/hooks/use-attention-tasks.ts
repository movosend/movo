import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router } from "expo-router";
import {
  receiverConfirmationDeadlineShortLabel,
  redesignationDeadlineLabel,
  shortAddressLabel,
} from "../lib/shipment-format";
import { useAuthStore } from "../store/auth-store";
import { getFirstName } from "../lib/profile-format";
import { usePublicProfiles } from "./use-profile";
import { useReceiverTransferInvitations } from "./use-receiver-transfers";
import { useAttentionSourceShipments } from "./use-shipments";

/** Tarea informativa de un solo botón (ej. "Recibiste 2 ofertas"). */
export interface AttentionInfoTask {
  kind: "info";
  id: string;
  /** Ícono del círculo de la card; sin valor, el genérico de aviso. */
  icon?: "offers";
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

/** MOVO-253: el receptor rechazó el envío y el emisor puede elegir a otra persona
 * hasta `deadlineLabel`. Se renderiza con `AttentionRejectedCard`. */
export interface AttentionRejectedTask {
  kind: "rejected";
  id: string;
  shipmentId: string;
  title: string;
  meta: string;
  /** Motivo que dejó el receptor al rechazar, si dejó uno. */
  reason: string | null;
  deadlineLabel: string;
  onPress: () => void;
  onChooseReceiver: () => void;
}

/** MOVO-275 AC8: el receptor de un envío le pidió al usuario que lo reciba en su lugar.
 * Se renderiza con `AttentionTransferInviteCard`; el emisor no tiene card (solo push). */
export interface AttentionTransferInviteTask {
  kind: "transfer_invite";
  id: string;
  transferId: string;
  title: string;
  meta: string;
  deadlineLabel: string;
  onPress: () => void;
}

export type AttentionTask =
  | AttentionInfoTask
  | AttentionConfirmTask
  | AttentionRejectedTask
  | AttentionTransferInviteTask;

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
 * - `REJECTED_BY_RECEIVER` con el usuario como emisor: el receptor rechazó el envío y
 *   el emisor puede elegir a otra persona hasta `receiverRedesignationDeadline`
 *   (MOVO-253). Con el plazo vencido (o nulo, rechazos anteriores a MOVO-253) la tarea
 *   no se lista: la acción ya no está disponible y el barrido cancela el envío.
 *
 * - `PUBLISHED` con el usuario como emisor y `pendingOffersCount > 0` (MOVO-184 AC5):
 *   recibió ofertas y tiene que elegir quién lo lleva. Tocar la card navega al
 *   detalle; "Ver ofertas" va directo a la pantalla de ofertas recibidas (MOVO-150).
 *   El conteo sale de `pendingOffersCount` de `/mine` (MOVO-257), sin un request por
 *   envío.
 *
 * La fuente pide solo esos estados (`useAttentionSourceShipments`, MOVO-253 AC8).
 *
 * Deliberadamente fuera de esta versión (gaps de backend a crear como ticket nuevo,
 * ver el comentario dejado en MOVO-192):
 * - "Calificaciones pendientes de dar": no existe ningún endpoint que liste envíos
 *   entregados sin calificar por el usuario actual (`ratings-client.ts` solo permite
 *   crear/leer una calificación puntual) — ver `MOVO-222`.
 * - "Fondos pendientes de reservar" (`assigned_unfunded`): ya se comunica en la
 *   propia card de envío activo (`ActiveShipmentCard`), no se duplica acá como tarea.
 */
export function useAttentionTasks() {
  const { data, isLoading } = useAttentionSourceShipments();
  const { data: invitations } = useReceiverTransferInvitations();
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
  const rejecterIds = Array.from(
    new Set(
      (data?.items ?? [])
        .filter(
          (shipment) =>
            shipment.status === ShipmentStatus.REJECTED_BY_RECEIVER &&
            shipment.senderId === currentUserId,
        )
        .map((shipment) => shipment.receiverId),
    ),
  );
  // Un solo `usePublicProfiles` para emisores y receptores que rechazaron: comparten
  // cache por id con el resto de la app.
  const profileIds = [...confirmSenderIds, ...rejecterIds];
  const profiles = usePublicProfiles(profileIds);
  const firstNameById = new Map(
    profileIds.map((id, index) => {
      const fullName = profiles[index]?.data?.fullName?.trim();
      return [id, fullName ? fullName.split(/\s+/)[0] : undefined];
    }),
  );

  const tasks: AttentionTask[] = [];
  // MOVO-275 AC8: invitaciones para recibir en lugar de otra persona, con el plazo que
  // queda. Una vencida (el barrido todavía no la cerró) no se lista.
  for (const invitation of invitations ?? []) {
    const deadlineLabel = redesignationDeadlineLabel(invitation.newReceiverDeadline);
    if (!deadlineLabel) continue;
    const requester = getFirstName(invitation.requesterName) || "Alguien";
    tasks.push({
      kind: "transfer_invite",
      id: `transfer-${invitation.id}`,
      transferId: invitation.id,
      title: `${requester} te pidió que recibas un paquete`,
      meta: `Recibís en ${shortAddressLabel(invitation.shipment.deliveryAddress)}`,
      deadlineLabel,
      onPress: () => router.push(`/receiver-transfers/${invitation.id}`),
    });
  }
  if (data && currentUserId) {
    for (const shipment of data.items) {
      if (
        shipment.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
        shipment.receiverId === currentUserId
      ) {
        const senderFirstName = firstNameById.get(shipment.senderId);
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
            ? `Recibís en ${shortAddressLabel(shipment.deliveryAddress)} · ${deadlineLabel}`
            : `Recibís en ${shortAddressLabel(shipment.deliveryAddress)}`,
          onPress: () => router.push(`/shipments/${shipment.id}`),
        });
      }
      if (
        shipment.status === ShipmentStatus.REJECTED_BY_RECEIVER &&
        shipment.senderId === currentUserId
      ) {
        const deadlineLabel = redesignationDeadlineLabel(shipment.receiverRedesignationDeadline);
        if (!deadlineLabel) continue;
        const rejecterFirstName = firstNameById.get(shipment.receiverId);
        tasks.push({
          kind: "rejected",
          id: `rejected-${shipment.id}`,
          shipmentId: shipment.id,
          title: rejecterFirstName
            ? `${rejecterFirstName} rechazó tu envío`
            : "El receptor rechazó tu envío",
          meta: `Iba a ${shortAddressLabel(shipment.deliveryAddress)}`,
          reason: shipment.rejectionReason ?? null,
          deadlineLabel,
          onPress: () => router.push(`/shipments/${shipment.id}`),
          onChooseReceiver: () => router.push(`/shipments/${shipment.id}/change-receiver`),
        });
      }
      const offersCount = shipment.pendingOffersCount ?? 0;
      if (
        shipment.status === ShipmentStatus.PUBLISHED &&
        shipment.senderId === currentUserId &&
        offersCount > 0
      ) {
        tasks.push({
          kind: "info",
          id: `offers-${shipment.id}`,
          icon: "offers",
          title: offersCount === 1 ? "Recibiste una oferta" : `Recibiste ${offersCount} ofertas`,
          meta: `Va a ${shortAddressLabel(shipment.deliveryAddress)}`,
          onPress: () => router.push(`/shipments/${shipment.id}`),
          primaryLabel: "Ver ofertas",
          onPrimary: () => router.push(`/shipments/${shipment.id}/offers`),
        });
      }
    }
  }

  return { tasks, isLoading };
}
