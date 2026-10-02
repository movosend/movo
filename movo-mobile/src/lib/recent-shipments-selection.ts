import type { ShipmentSummary } from "../api/shipments-client";
import {
  myShipmentClosedAt,
  myShipmentStage,
  presentMyShipment,
} from "./my-shipments-format";

export const TERMINAL_EXPIRATION_MS = 48 * 60 * 60 * 1000; // 48 horas

/**
 * Selecciona y ordena los envíos para la vista "Actividad reciente" de Inicio.
 *
 * AC1: Orden en 3 niveles:
 * 1. Requieren acción (según presentMyShipment.strip)
 * 2. En curso ("ongoing")
 * 3. Historial ("past")
 * Dentro de cada nivel, se ordena por createdAt desc.
 *
 * AC2: Expiración de terminales:
 * Los envíos `cancelled` y `rejected_by_receiver` (visto por el receptor) desaparecen
 * del widget pasadas 48 horas desde su último cambio de estado.
 * `delivered` y `completed` no expiran (se mantienen como fallback).
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
    
    // Si no es historial, siempre se muestra
    if (stage !== "history") return true;

    // Entregados/completados no expiran en el widget de home (siempre visibles si no hay activos)
    if (shipment.status === "delivered" || shipment.status === "completed") return true;

    // Cancelados y rechazados por el receptor expiran a las 48h
    const closedAt = myShipmentClosedAt(shipment);
    const msSinceClosed = now.getTime() - new Date(closedAt).getTime();
    
    return msSinceClosed <= TERMINAL_EXPIRATION_MS;
  });

  const withPriority = validItems.map((shipment) => {
    const presentation = presentMyShipment(shipment, userId, { now });
    let priority = 3; // Nivel 3: Historial
    
    if (presentation.stage === "ongoing") {
      priority = presentation.strip !== null ? 1 : 2; // Nivel 1: Acción, Nivel 2: Ongoing
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
