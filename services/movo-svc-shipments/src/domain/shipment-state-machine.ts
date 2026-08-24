import { ShipmentStatus } from "@movo/shared";

/**
 * Estado inicial de todo envío nuevo (MOVO-80): el receptor todavía no
 * confirmó ni rechazó.
 */
export const INITIAL_SHIPMENT_STATUS = ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION;

/**
 * Transición rechazada por la máquina de estados — ni `from` ni `to` son
 * necesariamente inválidos por sí solos, la combinación no está permitida.
 * Distinto de `InvalidEnumValueError` (patrón de `svc-users`): acá ambos
 * valores existen en `ShipmentStatus`, el problema es el borde del grafo.
 */
export class InvalidShipmentTransitionError extends Error {
  constructor(
    public readonly from: ShipmentStatus,
    public readonly to: ShipmentStatus,
  ) {
    super(`Transición de envío inválida: '${from}' -> '${to}'`);
    this.name = "InvalidShipmentTransitionError";
  }
}

/** AC6 de MOVO-81: mínimo de fotos de etapa `creation` para que un envío pueda pasar a
 * `published` (el receptor confirma, MOVO-16). No forma parte del grafo de transiciones
 * -- es una precondición de negocio sobre una transición que ya es estructuralmente
 * válida, por eso es un error de dominio separado de `InvalidShipmentTransitionError`. */
export const MIN_CREATION_PHOTOS_TO_PUBLISH = 2;

export class InsufficientCreationPhotosError extends Error {
  constructor(
    public readonly shipmentId: string,
    public readonly photoCount: number,
  ) {
    super(
      `El envío '${shipmentId}' tiene ${photoCount} foto(s) de etapa 'creation', ` +
        `se necesitan al menos ${MIN_CREATION_PHOTOS_TO_PUBLISH} para publicarlo`,
    );
    this.name = "InsufficientCreationPhotosError";
  }
}

/**
 * Grafo de transiciones válidas del ciclo de vida del envío — DTE de
 * MOVO-105 (`docs/shipments/state-diagram.md`, diagrama fuente adjunto en
 * el issue de Linear). Única fuente de verdad: cualquier cambio acá debe
 * reflejarse primero en el diagrama, no al revés (AC4).
 *
 * `rejected_by_receiver`, `cancelled` y `disputed` no tienen salida en este
 * módulo — los dos primeros son terminales por diseño (MOVO-79); la
 * resolución de una disputa (a cargo de un admin, MOVO-30/MOVO-32) todavía
 * no tiene ticket que defina a qué estado vuelve, así que no se modela acá
 * una transición inventada.
 */
const VALID_TRANSITIONS: Readonly<Record<ShipmentStatus, ReadonlySet<ShipmentStatus>>> = {
  [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION]: new Set([
    ShipmentStatus.PUBLISHED, // receptor confirma (MOVO-16)
    ShipmentStatus.REJECTED_BY_RECEIVER, // receptor rechaza (MOVO-16)
    ShipmentStatus.CANCELLED, // emisor cancela (MOVO-29)
  ]),
  [ShipmentStatus.PUBLISHED]: new Set([
    ShipmentStatus.ASSIGNMENT_PENDING, // emisor acepta oferta
    ShipmentStatus.CANCELLED, // emisor cancela (MOVO-29)
  ]),
  [ShipmentStatus.ASSIGNMENT_PENDING]: new Set([
    ShipmentStatus.PUBLISHED, // hold de fondos falla/timeout: vuelve a la saga
    ShipmentStatus.ASSIGNED, // fondos reservados
    ShipmentStatus.CANCELLED, // emisor cancela (MOVO-29)
  ]),
  [ShipmentStatus.ASSIGNED]: new Set([
    ShipmentStatus.IN_TRANSIT, // retiro confirmado (handshake, MOVO-6)
    ShipmentStatus.CANCELLED, // emisor cancela, con penalización
  ]),
  [ShipmentStatus.IN_TRANSIT]: new Set([
    ShipmentStatus.DELIVERED, // entrega confirmada (handshake)
    ShipmentStatus.DISPUTED, // reclamo en tránsito (MOVO-30)
  ]),
  [ShipmentStatus.DELIVERED]: new Set([
    ShipmentStatus.DISPUTED, // reclamo post-entrega (MOVO-30)
  ]),
  [ShipmentStatus.REJECTED_BY_RECEIVER]: new Set(),
  [ShipmentStatus.CANCELLED]: new Set(),
  [ShipmentStatus.DISPUTED]: new Set(),
};

/** Solo lectura — no muta el estado, es para consultas (ej. habilitar/deshabilitar una acción en UI). */
export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

/**
 * Única vía de transición válida del ciclo de vida del envío (AC1/AC2): todo
 * repositorio que escriba `status` pasa por acá antes del `UPDATE`, nunca lo
 * hace directo. Devuelve `to` si la transición es válida; lanza
 * `InvalidShipmentTransitionError` si no.
 */
export function transition(from: ShipmentStatus, to: ShipmentStatus): ShipmentStatus {
  if (!canTransition(from, to)) {
    throw new InvalidShipmentTransitionError(from, to);
  }
  return to;
}
