import type { ShipmentSummary } from "../api/shipments-client";
import {
  myShipmentClosedAt,
  myShipmentStage,
  presentMyShipment,
} from "./my-shipments-format";
import { isStalePrePickupShipment, isTodayOrYesterday } from "./home-visibility";

/**
 * Selecciona y ordena los envíos para la vista "Actividad reciente" de Inicio.
 *
 * AC1: Orden en 3 niveles:
 * 1. Requieren acción (según presentMyShipment.strip)
 * 2. En curso ("ongoing")
 * 3. Historial ("past")
 * Dentro de cada nivel, se ordena por createdAt desc.
 *
 * AC2: Expiración (`home-visibility.ts`): un envío cerrado sin completarse (`cancelled`,
 * `rejected_by_receiver` visto por el receptor, transferido) se ve el día del cierre y el
 * siguiente; uno abierto sin retirar con el día de retiro antes de ayer, tampoco, salvo que
 * todavía pida una acción. Después se ven en "Mis envíos". `delivered` y `completed` no
 * expiran (se mantienen como fallback).
 */
export function selectRecentShipments(
  items: ShipmentSummary[],
  userId: string,
  options: { now?: Date; limit?: number } = {},
): ShipmentSummary[] {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 3;

  const validItems = items.filter((shipment) => {
    const stage = myShipmentStage(shipment, userId);

    if (stage !== "history") {
      // Abierto pero vencido hace más de un día: sale de Inicio, salvo que pida una acción.
      if (!isStalePrePickupShipment(shipment, now)) return true;
      return presentMyShipment(shipment, userId, { now }).strip?.kind === "action";
    }

    // Entregados/completados no expiran en el widget de home (siempre visibles si no hay activos)
    if (shipment.status === "delivered" || shipment.status === "completed") return true;

    // Cerrados sin completarse: el día del cierre y el siguiente.
    return isTodayOrYesterday(new Date(myShipmentClosedAt(shipment)), now);
  });

  const withPriority = validItems.map((shipment) => {
    const presentation = presentMyShipment(shipment, userId, { now });
    let priority = 3; // Nivel 3: Historial
    
    if (presentation.stage === "ongoing") {
      // Solo una franja de acción sube al nivel 1; un aviso informativo (`warning`) no.
      priority = presentation.strip?.kind === "action" ? 1 : 2; // Nivel 1: Acción, Nivel 2: Ongoing
    }

    return { shipment, priority };
  });

  withPriority.sort((a, b) => {
    // 1. Por nivel de prioridad (ascendente, 1 antes que 2)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // 2. Por fecha de creación (descendente, más nuevo primero)
    return b.shipment.createdAt.localeCompare(a.shipment.createdAt);
  });

  return withPriority.map((item) => item.shipment).slice(0, limit);
}
