/**
 * MOVO-331 (DD-055): el admin del panel que ejecuta un servicio de dominio en nombre de un cambio
 * de estado. `kind` queda en el evento de la línea de tiempo: `manual` si es una transición normal,
 * `forced` si el admin la ejecuta con efectos distintos del camino normal (hoy: penalidad condonada).
 */
export interface AdminStatusActor {
  adminId: string;
  adminName: string;
  kind: "manual" | "forced";
}
