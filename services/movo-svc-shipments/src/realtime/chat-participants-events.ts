import { EventEmitter } from "node:events";

export interface ChatParticipantsChangedEvent {
  shipmentId: string;
}

/**
 * MOVO-340: avisa en el mismo proceso que cambiaron los integrantes del chat de un envío (hoy,
 * solo al completarse una transferencia de receptor), para que `realtime.ts` lo difunda a los
 * sockets de chat abiertos. Mismo criterio que `shipment-status-events.ts`: se emite después
 * de que la transacción confirma, y alcanza con un emisor en memoria porque el servicio corre
 * en una sola réplica (ADR-006).
 */
const chatParticipantsEvents = new EventEmitter();

const CHAT_PARTICIPANTS_CHANGED_EVENT = "chat-participants-changed";

export function emitChatParticipantsChanged(event: ChatParticipantsChangedEvent): void {
  chatParticipantsEvents.emit(CHAT_PARTICIPANTS_CHANGED_EVENT, event);
}

export function onChatParticipantsChanged(listener: (event: ChatParticipantsChangedEvent) => void): void {
  chatParticipantsEvents.on(CHAT_PARTICIPANTS_CHANGED_EVENT, listener);
}
