import { ActiveShipmentStatus, ShipmentStatus, toArgentinaCalendarDateString } from "@movo/shared";
import { isPickupWindowExpired } from "./pickup-window";

/**
 * MOVO-192 (AC6): "hoy" se calcula siempre en backend contra la zona horaria de
 * Argentina (la app no opera en otro huso, mismo criterio que `pickup-window.ts`) para
 * que el badge sea consistente entre dispositivos con reloj o zona horaria distintos.
 * `pickupDate` es `@db.Date` anclada a medianoche UTC (valor de calendario, no un
 * instante real -- ver el gotcha de timezone de MOVO-80) así que su día calendario sale
 * directo del ISO string, sin pasar por `toArgentinaCalendarDateString`: esa función es
 * para convertir un INSTANTE real (`now`) al día calendario argentino, no para releer
 * un valor que ya es un día calendario.
 */
export function isShipmentPickupToday(pickupDate: Date, now: Date = new Date()): boolean {
  return pickupDate.toISOString().slice(0, 10) === toArgentinaCalendarDateString(now);
}

/**
 * MOVO-192 (AC6): "la ventana de retiro ya pasó y el envío SIGUE en `assigned` o
 * `assigned_unfunded`" -- un envío `in_transit` ya fue retirado, así que su ventana de
 * retiro (pasada o no) dejó de ser relevante: nunca marca este flag, sin importar la
 * fecha/hora. Reusa `isPickupWindowExpired` (`pickup-window.ts`, ya usado por el
 * barrido de `published` vencidos) para el cálculo real del instante de cierre.
 */
export function isActiveShipmentPickupWindowExpired(
  status: ActiveShipmentStatus,
  pickupDate: Date,
  pickupTimeWindowEnd: Date,
  now: Date = new Date()
): boolean {
  if (status === ShipmentStatus.IN_TRANSIT) {
    return false;
  }
  return isPickupWindowExpired(pickupDate, pickupTimeWindowEnd, now);
}

export type ActiveShipmentRole = "sending" | "transporting" | "receiving";

/**
 * MOVO-192 (AC5): "la contraparte relevante según el rol consultado" -- resuelta contra
 * la acción de custodia que el usuario tiene pendiente (matriz de CTA del AC4 de
 * MOVO-191, la historia padre), no un campo fijo:
 * - `sending`/`receiving`: el transportista ya asignado -- es con quien el emisor
 *   coordina el retiro (`Generar retiro`) y con quien el receptor coordina la entrega
 *   (`Confirmar recepción`). Garantizado no-nulo: los tres estados de
 *   `ACTIVE_SHIPMENT_STATUSES` solo son alcanzables después de que una oferta fija
 *   `carrierId` (`offer-repository.ts#acceptOffer`).
 * - `transporting`: el emisor mientras el paquete todavía no salió de sus manos
 *   (`assigned_unfunded`/`assigned`, la próxima acción del transportista es retirarlo),
 *   el receptor una vez que ya está en camino (`in_transit`, la próxima acción es
 *   entregarlo) -- la contraparte sigue a la próxima acción, no es fija como en los
 *   otros dos roles.
 */
export function resolveActiveShipmentCounterpartyId(
  role: ActiveShipmentRole,
  shipment: { senderId: string; receiverId: string; carrierId: string | null; status: ShipmentStatus }
): string {
  switch (role) {
    case "sending":
    case "receiving":
      if (!shipment.carrierId) {
        throw new Error(
          `Envío activo sin carrierId -- inesperado para status='${shipment.status}' (ver ACTIVE_SHIPMENT_STATUSES)`
        );
      }
      return shipment.carrierId;
    case "transporting":
      return shipment.status === ShipmentStatus.IN_TRANSIT ? shipment.receiverId : shipment.senderId;
  }
}

/**
 * MOVO-192 (AC5): mismo algoritmo que `movo-mobile/src/lib/profile-format.ts#getInitials`
 * -- primera letra del primer y del último término del nombre completo, sin
 * intermedios (ej. "Juan Cruz Bordino" -> "JB", no "JC"). No se comparte el código
 * entre ambos lados (uno corre en Node, el otro en React Native, y `@movo/shared` no
 * tiene hoy ningún módulo de formato de texto) -- si diverge, es un bug a corregir acá
 * o allá, no una razón para introducir una dependencia cruzada nueva solo por esta
 * función. Nunca falla: `"?"` es el resultado explícito para un nombre vacío/ausente.
 */
export function getInitials(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}
