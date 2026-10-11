import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import { getFirstName } from "./profile-format";
import { formatEventTimestamp, redesignationDeadlineLabel } from "./shipment-format";

/**
 * MOVO-275 (ADR-037): textos de la transferencia de receptor. La línea de tiempo muestra
 * UN item por solicitud que cambia según su estado, y el texto depende de quién mira:
 * quien la pidió, la persona invitada, el emisor o el resto (transportista).
 */
export type ReceiverTransferViewer = "requester" | "new_receiver" | "sender" | "other";

export type ReceiverTransferTone = "warning" | "success" | "danger" | "neutral";

export function receiverTransferViewer(
  transfer: Pick<ReceiverTransferRequest, "requestedBy" | "newReceiverId">,
  currentUserId: string | null,
  senderId: string,
): ReceiverTransferViewer {
  if (currentUserId === null) return "other";
  if (currentUserId === transfer.requestedBy) return "requester";
  if (currentUserId === transfer.newReceiverId) return "new_receiver";
  if (currentUserId === senderId) return "sender";
  return "other";
}

function names(transfer: ReceiverTransferRequest) {
  return {
    requester: getFirstName(transfer.requesterName) || "El receptor",
    invited: getFirstName(transfer.newReceiverName) || "otra persona",
  };
}

/** Título del item de la línea de tiempo. */
export function receiverTransferTitle(transfer: ReceiverTransferRequest, viewer: ReceiverTransferViewer): string {
  const { requester, invited } = names(transfer);
  if (transfer.status === "completed") {
    switch (viewer) {
      case "requester":
        return `Le pasaste la recepción a ${invited}`;
      case "new_receiver":
        return `${requester} te pasó la recepción`;
      case "sender":
        return `${requester} le pasó la recepción a ${invited}`;
      default:
        return `Cambió quién recibe: ahora ${invited}`;
    }
  }
  switch (viewer) {
    case "requester":
      return `Le pediste a ${invited} que lo reciba`;
    case "new_receiver":
      return `${requester} te pidió que lo recibas`;
    default:
      return `${requester} le pidió a ${invited} que lo reciba`;
  }
}

/** Pill de estado del item. */
export function receiverTransferStatusPill(transfer: ReceiverTransferRequest): {
  label: string;
  tone: ReceiverTransferTone;
} {
  switch (transfer.status) {
    case "pending_new_receiver":
      return { label: "Esperando respuesta", tone: "warning" };
    case "completed":
      return { label: "Completada", tone: "success" };
    case "rejected_by_new_receiver":
      return { label: "No aceptó", tone: "danger" };
    case "expired":
      return { label: "Venció", tone: "neutral" };
    case "cancelled":
      return { label: "Cancelada", tone: "neutral" };
  }
}

/** Línea de resultado debajo del título: qué pasó con la solicitud y quién recibe. */
export function receiverTransferDetail(
  transfer: ReceiverTransferRequest,
  viewer: ReceiverTransferViewer,
  now: Date = new Date(),
): string | null {
  const { requester, invited } = names(transfer);
  const keeps = viewer === "requester" ? "Lo seguís recibiendo vos." : `Lo sigue recibiendo ${requester}.`;
  switch (transfer.status) {
    case "pending_new_receiver": {
      const deadline = redesignationDeadlineLabel(transfer.newReceiverDeadline, now);
      if (!deadline) return `Si ${invited} no acepta, ${keeps.charAt(0).toLowerCase()}${keeps.slice(1)}`;
      return `${deadline.replace(/^Tenés/, "Tiene")} para aceptar.`;
    }
    case "completed":
      return viewer === "requester"
        ? "Seguís viendo el envío en modo lectura."
        : viewer === "new_receiver"
          ? "Recibís vos y firmás la entrega con el transportista."
          : "La dirección de entrega no cambia.";
    case "rejected_by_new_receiver":
      return `${invited} no aceptó. ${keeps}`;
    case "expired":
      return `${invited} no respondió a tiempo. ${keeps}`;
    case "cancelled":
      if (transfer.cancelReason === "delivery_started") {
        return `Se canceló porque empezó la entrega. ${keeps}`;
      }
      return viewer === "requester" ? "Cancelaste la solicitud." : `${requester} canceló la solicitud.`;
  }
}

export interface ReceiverTransferStep {
  key: string;
  time: string | null;
  text: string;
}

/** Pasos del item desplegado: la solicitud y, si ya se resolvió, su resultado. */
export function receiverTransferSteps(
  transfer: ReceiverTransferRequest,
  viewer: ReceiverTransferViewer,
): ReceiverTransferStep[] {
  const { requester, invited } = names(transfer);
  const steps: ReceiverTransferStep[] = [
    {
      key: "requested",
      time: formatEventTimestamp(transfer.createdAt),
      text: viewer === "requester" ? `Le pediste a ${invited} que lo reciba` : `${requester} pidió que lo reciba ${invited}`,
    },
  ];
  if (!transfer.resolvedAt) return steps;
  const time = formatEventTimestamp(transfer.resolvedAt);
  switch (transfer.status) {
    case "completed":
      steps.push({ key: "accepted", time, text: viewer === "new_receiver" ? "Aceptaste recibirlo" : `${invited} aceptó` });
      steps.push({
        key: "changed",
        time,
        text: viewer === "new_receiver" ? "Ahora el receptor sos vos" : `Ahora el receptor es ${invited}`,
      });
      break;
    case "rejected_by_new_receiver":
      steps.push({ key: "rejected", time, text: `${invited} no aceptó` });
      break;
    case "expired":
      steps.push({ key: "expired", time, text: "Venció el plazo para aceptar" });
      break;
    case "cancelled":
      steps.push({
        key: "cancelled",
        time,
        text:
          transfer.cancelReason === "delivery_started"
            ? "Se canceló al empezar la entrega"
            : viewer === "requester"
              ? "Cancelaste la solicitud"
              : `${requester} canceló la solicitud`,
      });
      break;
    default:
      break;
  }
  return steps;
}

/** Fecha corta para el banner del receptor original ("vie 10 oct 09:20"). */
export function formatTransferDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return formatEventTimestamp(iso);
}
