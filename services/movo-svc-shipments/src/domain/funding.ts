import {
  ShipmentStatus,
  type CarrierFundingView,
  type FundingAttempt,
  type FundingCard,
  type FundingLapseReason,
  type FundingRoute,
  type HoldResponse,
  type SenderFundingView,
} from "@movo/shared";

/**
 * MOVO-210: reglas puras de la saga de asignación (pago del emisor), sin DB ni reloj propio
 * (`now` siempre lo pasa el caller), mismo criterio que `expiration.ts`/`pickup-window.ts`.
 *
 * `pickupStart` es siempre el INICIO de la ventana de retiro EFECTIVA acordada (la de la
 * oferta aceptada, ver `acceptedOfferPickupWindowStartInstant`): el hold se ancla al
 * momento en que el transportista puede empezar a retirar.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Ruta de la saga. "Dentro de N días" es inclusivo: un retiro exactamente a N días toma la
 * ruta cercana, y a N días más un instante, la lejana.
 */
export function selectFundingRoute(pickupStart: Date, now: Date, nearDays: number): FundingRoute {
  return pickupStart.getTime() - now.getTime() <= nearDays * DAY_MS ? "near" : "far";
}

/** Instante en que se abre la ventana de confirmación de la ruta lejana (retiro entra en N días). */
export function fundingWindowOpensAt(pickupStart: Date, nearDays: number): Date {
  return new Date(pickupStart.getTime() - nearDays * DAY_MS);
}

/** Último instante en que el emisor puede pagar en la ruta lejana: T-24h del retiro. */
export function farRouteFundingDeadline(pickupStart: Date, releaseHoursBeforePickup: number): Date {
  return new Date(pickupStart.getTime() - releaseHoursBeforePickup * HOUR_MS);
}

/**
 * Último instante en que el emisor puede pagar en la ruta cercana: `acceptedAt + timeout`,
 * con tope en el cierre de la ventana de retiro (no tiene sentido pagar un retiro que ya pasó).
 */
export function nearRouteFundingDeadline(acceptedAt: Date, timeoutMinutes: number, pickupEnd: Date): Date {
  const timeoutDeadline = new Date(acceptedAt.getTime() + timeoutMinutes * 60 * 1000);
  return timeoutDeadline <= pickupEnd ? timeoutDeadline : pickupEnd;
}

/** `true` si la ruta lejana ya abrió su ventana de confirmación. */
export function isFundingWindowOpen(pickupStart: Date, nearDays: number, now: Date): boolean {
  return fundingWindowOpensAt(pickupStart, nearDays) <= now;
}

/** Cubeta (entera) del recordatorio: cambia cada `intervalHours`, para deduplicar avisos por barrido. */
export function reminderBucket(now: Date, intervalHours: number): number {
  return Math.floor(now.getTime() / (Math.max(1, intervalHours) * HOUR_MS));
}

/** Lo que la proyección necesita del hold más reciente del envío (MOVO-211). */
export type FundingViewHold = Pick<
  HoldResponse,
  "status" | "failureReason" | "carrierId" | "cardBrand" | "cardLastFour" | "createdAt"
>;

/** Lo que la proyección necesita del último `shipment_event`. */
export interface FundingViewEvent {
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  createdAt: Date;
}

export interface SenderFundingViewInput {
  status: ShipmentStatus;
  carrierId: string | null;
  amountArs: number | null;
  /** Inicio de la ventana de retiro acordada. */
  pickupStart: Date;
  /** Plazo de pago del estado actual (`payUntilOf`), solo en `assignment_pending`/`assigned_unfunded`. */
  payUntil: Date | null;
  nearPickupDays: number;
  /** Cuándo entró el envío a su estado actual. */
  statusChangedAt: Date | null;
  /** `undefined` = payments no respondió (falla abierto); `null` = no hay hold. */
  hold: FundingViewHold | null | undefined;
  lastEvent: FundingViewEvent | null;
  now: Date;
}

function cardOf(hold: FundingViewHold | null | undefined): FundingCard | null {
  if (!hold?.cardBrand || !hold.cardLastFour) return null;
  return { brand: hold.cardBrand, lastFour: hold.cardLastFour };
}

/**
 * Resultado del último intento de pago de la asignación ACTUAL. Un hold de otro
 * transportista, o creado antes de entrar al estado (una asignación anterior que se cayó),
 * no cuenta: el emisor todavía no intentó pagar esta.
 */
function attemptOf(
  hold: FundingViewHold | null,
  carrierId: string | null,
  statusChangedAt: Date | null,
): { lastAttempt: FundingAttempt; failureReason: HoldResponse["failureReason"] } {
  const current =
    hold !== null &&
    hold.carrierId === carrierId &&
    (statusChangedAt === null || new Date(hold.createdAt).getTime() >= statusChangedAt.getTime());
  if (!current) return { lastAttempt: "none", failureReason: null };
  if (hold.status === "rejected") return { lastAttempt: "rejected", failureReason: hold.failureReason };
  // `authorized`/`captured` con el envío todavía sin confirmar: la saga lo está confirmando.
  if (hold.status === "in_process" || hold.status === "authorized" || hold.status === "captured") {
    return { lastAttempt: "in_process", failureReason: null };
  }
  // `creating` abandonado o `cancelled`: no se retuvo nada, el pago quedó sin terminar.
  return { lastAttempt: "none", failureReason: null };
}

/** Por qué una asignación volvió a `published`, según de qué estado salió. */
export function fundingLapseReasonOf(event: FundingViewEvent | null): FundingLapseReason | null {
  if (!event || event.toStatus !== ShipmentStatus.PUBLISHED) return null;
  if (event.fromStatus === ShipmentStatus.ASSIGNMENT_PENDING) return "payment_timeout";
  if (event.fromStatus === ShipmentStatus.ASSIGNED_UNFUNDED) return "window_expired";
  return null;
}

/**
 * MOVO-211: estado de la reserva que ve el emisor en el detalle del envío. `null` cuando no
 * hay nada que mostrar (todavía sin transportista, o cancelado sin que se haya reservado nada).
 */
export function computeSenderFundingView(input: SenderFundingViewInput): SenderFundingView | null {
  const { status, amountArs, hold } = input;

  if (status === ShipmentStatus.PUBLISHED) {
    const reason = fundingLapseReasonOf(input.lastEvent);
    if (!reason || !input.lastEvent) return null;
    return { viewer: "sender", phase: "lapsed", reason, at: input.lastEvent.createdAt.toISOString() };
  }

  if (amountArs === null) return null;

  if (status === ShipmentStatus.ASSIGNED_UNFUNDED || status === ShipmentStatus.ASSIGNMENT_PENDING) {
    if (input.payUntil === null) return null;
    const payUntil = input.payUntil.toISOString();
    if (
      status === ShipmentStatus.ASSIGNED_UNFUNDED &&
      !isFundingWindowOpen(input.pickupStart, input.nearPickupDays, input.now)
    ) {
      return {
        viewer: "sender",
        phase: "awaiting_window",
        windowOpensAt: fundingWindowOpensAt(input.pickupStart, input.nearPickupDays).toISOString(),
        payUntil,
        amountArs,
      };
    }
    const known = hold !== undefined;
    const attempt = known ? attemptOf(hold, input.carrierId, input.statusChangedAt) : null;
    const holdLost =
      status === ShipmentStatus.ASSIGNED_UNFUNDED &&
      input.lastEvent?.fromStatus === ShipmentStatus.ASSIGNED &&
      input.lastEvent.toStatus === ShipmentStatus.ASSIGNED_UNFUNDED;
    return {
      viewer: "sender",
      phase: "payment_due",
      route: status === ShipmentStatus.ASSIGNMENT_PENDING ? "near" : "far",
      payUntil,
      amountArs,
      lastAttempt: attempt?.lastAttempt ?? null,
      failureReason: attempt?.failureReason ?? null,
      card: attempt?.lastAttempt === "rejected" || attempt?.lastAttempt === "in_process" ? cardOf(hold) : null,
      holdLost,
    };
  }

  if (
    status === ShipmentStatus.ASSIGNED ||
    status === ShipmentStatus.IN_TRANSIT ||
    status === ShipmentStatus.DELIVERED
  ) {
    return { viewer: "sender", phase: "held", amountArs, card: cardOf(hold) };
  }

  if (status === ShipmentStatus.COMPLETED) {
    return {
      viewer: "sender",
      phase: "captured",
      amountArs,
      at: (input.statusChangedAt ?? input.now).toISOString(),
    };
  }

  // `cancelled` con una reserva que llegó a MP y se liberó (un hold `rejected` nunca retuvo nada).
  if (status === ShipmentStatus.CANCELLED && hold && hold.carrierId === input.carrierId && hold.status === "cancelled") {
    return { viewer: "sender", phase: "released", amountArs };
  }

  return null;
}

/**
 * MOVO-211 AC2: lo que ve el transportista asignado, sin montos, tarjeta ni motivos de
 * rechazo del emisor. Solo "pago pendiente" o "reservado".
 */
export function toCarrierFundingView(view: SenderFundingView | null): CarrierFundingView | null {
  if (!view) return null;
  if (view.phase === "awaiting_window" || view.phase === "payment_due") {
    return { viewer: "carrier", phase: "sender_payment_pending", payUntil: view.payUntil };
  }
  if (view.phase === "held") return { viewer: "carrier", phase: "held" };
  return null;
}
