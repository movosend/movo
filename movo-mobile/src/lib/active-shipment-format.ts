import type { ActiveShipmentSummary } from "../api/shipments-client";
import { formatTimeHHMM } from "./shipment-format";

/** Rol efectivo con el que se consultó el envío activo — "sending"/"receiving" son
 * los dos únicos implementados en esta fase (ver `use-active-shipments.ts`);
 * "transporting" queda para la fase 2 con la card de viaje agregado. */
export type ActiveShipmentRole = "sending" | "receiving";

const ACTIVE_STATUS_LABEL: Record<Exclude<ActiveShipmentSummary["status"], "assigned_unfunded">, string> = {
  assigned: "Asignado",
  in_transit: "En camino",
};

/**
 * "Transportista asignado" a secas no decía nada nuevo (feedback del usuario: "no
 * tiene sentido") en la card "flat"/`assigned_unfunded` (fondos todavía sin
 * reservar, previa a que el transportista arranque el viaje) — el contrato de
 * MOVO-192 (todavía Todo) no trae ningún timestamp real de "arranque del viaje",
 * así que en vez de inventar uno se usa el inicio de la ventana de retiro que el
 * envío ya trae (`pickupTimeWindowStart`) — la misma que se ve en la sección
 * "Retiro" de más abajo, es la mejor aproximación disponible a esa hora. El resto
 * de los estados no tiene ninguna hora asociada que mostrar, quedan como texto fijo.
 */
export function activeShipmentStatusLabel(
  shipment: Pick<ActiveShipmentSummary, "status" | "pickupTimeWindowStart">,
): string {
  if (shipment.status === "assigned_unfunded") {
    return `Retira ${formatTimeHHMM(shipment.pickupTimeWindowStart)}`;
  }
  return ACTIVE_STATUS_LABEL[shipment.status];
}

/**
 * Código corto para el encabezado de la card (headline mono, "Home operativo
 * v2.dc.html" mockeaba `#MOVO-4821`, siempre numérico) — no existe ningún código de
 * referencia real en el backend (ni en `ShipmentSummary` ni en el contrato propuesto
 * de MOVO-192), así que se deriva del `id` (UUID) real del envío en vez de mostrar
 * precio o inventar un correlativo que el backend no persiste. Solo los dígitos del
 * `id`, los últimos 5 (rellenando con ceros a la izquierda si el `id` no tiene
 * suficientes) — nunca letras, para que se lea igual que el mock. Determinístico
 * (mismo envío → mismo código siempre) y solo para mostrar: nunca se usa para buscar
 * ni identificar el envío contra el backend, eso sigue siendo `shipment.id` completo.
 */
export function activeShipmentDisplayCode(id: string): string {
  const digits = id.replace(/\D/g, "");
  const suffix = digits.slice(-5).padStart(5, "0");
  return `#MOVO-${suffix}`;
}

export interface ActiveShipmentCta {
  label: string;
  /** Ticket de Linear al que apunta esta acción — MOVO-159/160 todavía no tienen
   * pantalla propia en el repo, así que por ahora el botón muestra un aviso "Muy
   * pronto" con este destino en vez de navegar a una ruta inventada (mismo criterio
   * ya aceptado en MOVO-183 para "Abrir Mis ofertas completo"). */
  destination: string;
  /** "primary" (lime, default): la acción que hace avanzar el envío
   * (Generar retiro/Confirmar recepción). "secondary" (negro): solo consultar algo
   * (Ver en el mapa) — mismo criterio de jerarquía visual que el resto de la app
   * (un CTA por pantalla se lleva el acento lime, el resto usa `bg-fg`). */
  variant?: "primary" | "secondary";
}

/**
 * Matriz de acción contextual del AC5 de MOVO-193, recortada a los roles sending/
 * receiving (emisor/receptor) de esta fase — transportista queda para la fase 2.
 * `assigned_unfunded` nunca tiene CTA: la máquina de estados de MOVO-208 AC2 rechaza
 * `assigned_unfunded -> in_transit`, así que ofrecer un botón de retiro ahí mandaría
 * al usuario a un error.
 *
 * El emisor con el envío `in_transit` no tenía ninguna acción (solo el texto de
 * la fila inferior, `activeShipmentFooterText`) — el prototipo sí muestra un CTA
 * acá ("Ver en el mapa"), mismo criterio que el resto de la matriz: sin tracking
 * en vivo real (MOVO-203/MOVO-11) todavía no hay a dónde navegar, así que dispara
 * el mismo aviso "Muy pronto" que MOVO-159/160.
 */
export function activeShipmentCta(
  role: ActiveShipmentRole,
  shipment: ActiveShipmentSummary,
): ActiveShipmentCta | null {
  if (shipment.status === "assigned_unfunded") return null;
  if (role === "sending" && shipment.status === "assigned") {
    return { label: "Generar retiro", destination: "MOVO-159 · QR de retiro" };
  }
  if (role === "sending" && shipment.status === "in_transit") {
    return {
      label: "Ver en el mapa",
      destination: "MOVO-203/MOVO-11 · Tracking en vivo",
      variant: "secondary",
    };
  }
  if (role === "receiving" && shipment.status === "in_transit") {
    return { label: "Confirmar recepción", destination: "MOVO-160 · Escaneo de entrega" };
  }
  return null;
}

/** Texto informativo cuando el envío no tiene ninguna acción contextual todavía
 * (`assigned_unfunded` en cualquier rol, o un combo rol/estado sin CTA en el AC5 —
 * por ejemplo el emisor mientras el envío ya está `in_transit`, nada que hacer hasta
 * la entrega). */
export function activeShipmentInfoText(
  role: ActiveShipmentRole,
  shipment: ActiveShipmentSummary,
): string {
  if (shipment.status === "assigned_unfunded") {
    return role === "sending"
      ? "Los fondos se reservan antes del retiro."
      : "Pendiente de que se reserven los fondos.";
  }
  if (role === "sending" && shipment.status === "in_transit") return "En camino a destino.";
  if (role === "receiving" && shipment.status === "assigned") return "Todavía no salió a entregar.";
  return "";
}

/** Texto corto de la fila inferior de la card (fila "footer" de "Home operativo
 * v2.dc.html") — siempre presente, junto al CTA cuando lo hay. Frases generadas a
 * partir de datos reales (rol, nombre de la contraparte, estado), nunca un dato
 * inventado (hora/ETA que el backend no manda). */
export function activeShipmentFooterText(
  role: ActiveShipmentRole,
  shipment: ActiveShipmentSummary,
): string {
  const name = shipment.counterparty.name;
  if (shipment.status === "assigned_unfunded") return activeShipmentInfoText(role, shipment);
  if (role === "sending") {
    return shipment.status === "assigned" ? `${name} retira con este código` : `${name} lo lleva`;
  }
  return shipment.status === "assigned" ? `${name} todavía no salió` : `${name} te lo trae`;
}

/**
 * Día de retiro relativo a hoy, solo para los dos casos que tienen una palabra
 * corta y sin ambigüedad ("hoy"/"mañana") — cualquier otro día no devuelve nada en
 * vez de forzar una frase tipo "el jueves" que necesitaría lidiar con semanas
 * distintas. `pickupDate` viaja como `"YYYY-MM-DD"` (wire format, sin hora) — se
 * parsea con año/mes/día explícitos, mismo criterio que `formatPickupDateLabel`,
 * para no interpretarlo como medianoche UTC y correr el día en Argentina (UTC-3).
 * `isToday` ya viene resuelto en el contrato (evita duplicar ese cálculo acá);
 * "mañana" sí se resuelve client-side porque no hay un `isTomorrow` en
 * `ActiveShipmentSummary`.
 */
export function activeShipmentPickupDayLabel(
  shipment: Pick<ActiveShipmentSummary, "pickupDate" | "isToday">,
  now: Date = new Date(),
): "hoy" | "mañana" | null {
  if (shipment.isToday) return "hoy";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipment.pickupDate)) return null;
  const [year, month, day] = shipment.pickupDate.split("-").map(Number);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow =
    year === tomorrow.getFullYear() && month - 1 === tomorrow.getMonth() && day === tomorrow.getDate();
  return isTomorrow ? "mañana" : null;
}

/**
 * Subtítulo del encabezado ("Nicolás Vera retira hoy") — reemplaza al chip "Hoy"
 * suelto de antes (feedback del usuario: mover esa información al texto en vez de
 * un pill aparte) y al nombre solo que había antes de eso. "Retira" es siempre la
 * acción del transportista (`counterparty` en ambos roles, ver
 * `activeShipmentFooterText`) — no aplica una vez que ya salió (`in_transit`), ahí
 * el subtítulo vuelve a ser solo el nombre.
 */
export function activeShipmentSubtitle(
  shipment: Pick<ActiveShipmentSummary, "status" | "pickupDate" | "isToday" | "counterparty">,
  now?: Date,
): string {
  const name = shipment.counterparty.name;
  if (shipment.status === "in_transit") return name;
  const dayLabel = activeShipmentPickupDayLabel(shipment, now);
  return dayLabel ? `${name} retira ${dayLabel}` : name;
}

/** Los 4 pasos fijos del stepper de la live card (`buildSteps()` del prototipo) —
 * siempre los mismos 4, en el mismo orden, sin importar rol o estado. "Llegando" es
 * un paso puramente visual: sin tracking en vivo (MOVO-203/MOVO-11) nunca se marca
 * como el paso actual, solo aparece "futuro" hasta que el envío se entrega. */
export const ACTIVE_SHIPMENT_STEPS = ["Retiro", "En camino", "Llegando", "Entrega"] as const;

/**
 * Índice del paso actual del stepper — `assigned_unfunded`/`assigned` (todavía no
 * salió) se paran en "Retiro" (0); `in_transit` avanza a "En camino" (1). Nunca
 * llega a "Llegando" (2) automáticamente: esta fase no tiene la señal de proximidad
 * que necesitaría para eso.
 */
export function activeShipmentStepIndex(status: ActiveShipmentSummary["status"]): number {
  return status === "in_transit" ? 1 : 0;
}
