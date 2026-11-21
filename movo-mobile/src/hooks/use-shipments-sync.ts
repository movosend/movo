import { useInvalidateOnPushOrForeground } from "./use-invalidate-on-push-or-foreground";

/** Pushes de un cambio de estado del envío que hace otra persona (Movo, desde el panel): abrir o resolver una disputa. */
const SHIPMENT_CHANGING_PUSH_TYPES: readonly string[] = ["dispute_opened", "dispute_resolved"];

/**
 * Lo que cambia cuando se abre o se resuelve una disputa:
 * - el detalle del envío (también lo usa el chat), su línea de tiempo y las listas propias ("Mis envíos", los activos
 *   de Inicio y "Estoy transportando");
 * - la lista de chats y los mensajes, cuyo `access` decide si el chat se puede leer: a favor del emisor el backend
 *   cierra el chat;
 * - "Mis ofertas", que calcula si una oferta aceptada sigue abierta según el estado del envío.
 * Los viajes los refresca `useTripsSync`.
 */
const SHIPMENT_QUERY_PREFIXES = [
  ["shipments", "detail"],
  ["shipments", "events"],
  ["shipments", "mine"],
  ["shipments", "active"],
  ["shipments", "transporting"],
  ["chat", "list"],
  ["chat", "messages"],
  ["offers", "mine"],
] as const;

/**
 * Refresca el envío cuando llega una push de disputa en primer plano y cada vez que la app vuelve a primer plano (también
 * al tocar la push). Sin esto, con el chat abierto la resolución no aparecía hasta salir y volver (feedback de
 * TestFlight, build 19); una pantalla que quedó montada no se vuelve a montar, así que refrescar al montar no alcanza.
 */
export function useShipmentsSync(): void {
  useInvalidateOnPushOrForeground(SHIPMENT_QUERY_PREFIXES, SHIPMENT_CHANGING_PUSH_TYPES);
}
