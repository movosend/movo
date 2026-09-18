import { Shipment, ShipmentEvent } from "../models/shipment";
import { RatingRole } from "../models/rating";
import { FULFILLED_SHIPMENT_STATUSES } from "./shipment-state-machine";
import { isRatingWindowOpen } from "./rating-window";

/**
 * MOVO-222: regla de "interacción física" de MOVO-153 (`movo-mobile`) — a quién se
 * espera que cada rol califique. El ticket pide explícitamente no cambiar esta regla
 * (solo consumirla), pero hasta ahora vivía únicamente del lado del cliente:
 * `ratings.service.ts` (MOVO-146) no la impone, deja que cualquier parte del envío
 * califique a cualquier otra. Esta es la primera vez que el pareo se expresa del lado
 * del backend — necesario para poder calcular, sin adivinar, a quién le falta
 * calificar el usuario autenticado.
 */
function expectedRateeRoles(callerRole: RatingRole): readonly RatingRole[] {
  switch (callerRole) {
    case RatingRole.sender:
    case RatingRole.receiver:
      return [RatingRole.carrier];
    case RatingRole.carrier:
      return [RatingRole.sender, RatingRole.receiver];
  }
}

function resolveCallerRoles(
  shipment: Pick<Shipment, "senderId" | "receiverId" | "carrierId">,
  callerId: string,
): RatingRole[] {
  const roles: RatingRole[] = [];
  if (shipment.senderId === callerId) roles.push(RatingRole.sender);
  if (shipment.carrierId === callerId) roles.push(RatingRole.carrier);
  if (shipment.receiverId === callerId) roles.push(RatingRole.receiver);
  return roles;
}

/**
 * AC de MOVO-222: roles de contraparte que `callerId` todavía no calificó en este
 * envío. `[]` si el envío no está en condiciones de calificarse — misma precondición
 * que `assertRatingWindowAllowsWrite` de `ratings.service.ts` (MOVO-146 AC3/AC8/AC9:
 * no `delivered`/`completed`, o ventana de 72hs vencida), reevaluada acá en modo
 * lectura (devuelve un resultado en vez de lanzar `ApiError`) — esa función está
 * pensada para el camino de escritura (POST/PATCH), no se reusa directo. Un envío
 * `disputed` nunca llega a evaluar la ventana: no está en `FULFILLED_SHIPMENT_STATUSES`
 * (AC9, la disputa suspende la calificación), consistente sin necesitar un chequeo
 * aparte.
 */
export function computePendingRatingFor(
  shipment: Pick<Shipment, "senderId" | "receiverId" | "carrierId" | "status" | "deliveredAt">,
  events: readonly ShipmentEvent[],
  callerId: string,
  alreadyRatedRoles: ReadonlySet<RatingRole>,
  now: Date = new Date(),
): RatingRole[] {
  if (!FULFILLED_SHIPMENT_STATUSES.includes(shipment.status) || !shipment.deliveredAt) {
    return [];
  }
  if (!isRatingWindowOpen(shipment.deliveredAt, events, now)) {
    return [];
  }

  const expected = new Set<RatingRole>();
  for (const callerRole of resolveCallerRoles(shipment, callerId)) {
    for (const rateeRole of expectedRateeRoles(callerRole)) {
      expected.add(rateeRole);
    }
  }

  return [...expected].filter((role) => !alreadyRatedRoles.has(role));
}
