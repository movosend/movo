import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import { getFirstName } from "./profile-format";
import { formatEventTimestamp, redesignationDeadlineLabel } from "./shipment-format";

/** Hora en 24 h ("09:20"), como en los pasos del prototipo: alinea en la columna mono. */
const TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

const DAY_FORMATTER = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

function formatTime(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : TIME_FORMATTER.format(date);
}

/** "10 oct 09:20": fecha corta y hora en 24 h, mismo formato que la hora de los pasos. */
function formatDayTime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${DAY_FORMATTER.format(date).replace(".", "")} ${TIME_FORMATTER.format(date)}`;
}

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

/** Línea de resultado debajo del título: qué pasó con la solicitud y quién recibe. En la
 * completada no se usa como línea aparte: va al final del último paso (`receiverTransferSteps`). */
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
      if (viewer === "requester") {
        return deadline
          ? `${deadline.replace(/^Tenés/, "Tiene")} para aceptar. Podés cancelar la solicitud.`
          : `Si ${invited} no acepta, lo seguís recibiendo vos.`;
      }
      return `Solo informativo. Si ${invited} no acepta, lo sigue recibiendo ${requester}.`;
    }
    case "completed":
      switch (viewer) {
        case "requester":
          return "Seguís viendo el envío en modo lectura.";
        case "new_receiver":
          return "Firmás la entrega con el transportista.";
        case "sender":
          return "La dirección de entrega no cambia.";
        default:
          return `La entrega la firma ${invited}. Misma dirección.`;
      }
    case "rejected_by_new_receiver":
      return `${invited} no aceptó. ${keeps}`;
    case "expired":
      return `${invited} no respondió a tiempo. ${keeps}`;
    case "cancelled":
      if (transfer.cancelReason === "delivery_started") {
        return viewer === "requester"
          ? "Se canceló: el transportista empezó la entrega. Lo seguís recibiendo vos."
          : `Se canceló porque empezó la entrega. ${keeps}`;
      }
      return viewer === "requester"
        ? "Cancelaste la solicitud. Lo seguís recibiendo vos."
        : `${requester} canceló la solicitud y lo sigue recibiendo.`;
  }
}

/** Hora sola si el instante cae el mismo día que `reference`; si no, fecha y hora. */
function timeLabel(iso: string, reference: string): string | null {
  const date = new Date(iso);
  const ref = new Date(reference);
  if (Number.isNaN(date.getTime())) return null;
  return date.toDateString() === ref.toDateString() ? formatTime(iso) : formatDayTime(iso);
}

/**
 * Línea de fecha del item mientras no está completado: cuándo se pidió y, si ya se
 * resolvió, cuándo. La completada no la usa: sus pasos ya llevan las horas.
 */
export function receiverTransferMeta(transfer: ReceiverTransferRequest): string | null {
  const created = formatDayTime(transfer.createdAt);
  if (!created) return null;
  if (!transfer.resolvedAt || transfer.status === "completed" || transfer.status === "pending_new_receiver") {
    return created;
  }
  const { invited } = names(transfer);
  const at = timeLabel(transfer.resolvedAt, transfer.createdAt);
  if (!at) return created;
  switch (transfer.status) {
    case "rejected_by_new_receiver":
      return `${created} · ${invited} respondió ${at}`;
    case "expired":
      return `${created} · Venció ${at}`;
    case "cancelled":
      return `${created} · Cancelada ${at}`;
  }
}

/**
 * Motivo entre comillas del item: el del rechazo cuando la persona invitada no aceptó, y si
 * no el que escribió quien la pidió. Vencida y cancelada no muestran ninguno.
 */
export function receiverTransferQuote(transfer: ReceiverTransferRequest): string | null {
  switch (transfer.status) {
    case "rejected_by_new_receiver":
      return transfer.responseReason;
    case "pending_new_receiver":
    case "completed":
      return transfer.reason;
    default:
      return null;
  }
}

export interface ReceiverTransferStep {
  key: string;
  time: string | null;
  text: string;
}

/**
 * Pasos de la transferencia completada (siempre visibles en el item): el pedido, la
 * aceptación y el cambio de receptor, este último con lo que implica para quien mira.
 */
export function receiverTransferSteps(
  transfer: ReceiverTransferRequest,
  viewer: ReceiverTransferViewer,
): ReceiverTransferStep[] {
  const { requester, invited } = names(transfer);
  const requested =
    viewer === "requester"
      ? `Le pediste a ${invited} que lo reciba`
      : viewer === "new_receiver"
        ? `${requester} te pidió que lo recibas`
        : `${requester} le pidió a ${invited} que lo reciba`;
  const steps: ReceiverTransferStep[] = [
    { key: "requested", time: formatTime(transfer.createdAt), text: requested },
  ];
  if (transfer.status !== "completed" || !transfer.resolvedAt) return steps;
  const time = timeLabel(transfer.resolvedAt, transfer.createdAt);
  const detail = receiverTransferDetail(transfer, viewer);
  steps.push({ key: "accepted", time, text: viewer === "new_receiver" ? "Aceptaste" : `${invited} aceptó` });
  steps.push({
    key: "changed",
    time,
    text: `${viewer === "new_receiver" ? "Ahora el receptor sos vos" : `Ahora el receptor es ${invited}`}. ${detail ?? ""}`.trim(),
  });
  return steps;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("es-AR", { weekday: "short" });

/** Fecha para el banner del receptor original: "vie 10 oct a las 09:20". */
export function formatTransferDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const weekday = WEEKDAY_FORMATTER.format(date).replace(".", "");
  const day = DAY_FORMATTER.format(date).replace(".", "");
  return `${weekday} ${day} a las ${TIME_FORMATTER.format(date)}`;
}
