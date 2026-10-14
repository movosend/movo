/** MOVO-179: primer componente de una dirección ("Av. Colón 1234, Córdoba" ->
 * "Av. Colón 1234"), para el copy de las push. Lo usan los avisos de envíos y, desde
 * MOVO-240, el recordatorio del día anterior al viaje. */
export function shortAddress(address: string): string {
  return address.split(",")[0].trim();
}
