/**
 * Coreografía del sheet de "Mi ruta" (MOVO-237, mockup 2a "Morph desde la parada activa"
 * de Claude Design). Un solo lugar para la duración y la curva, así el sheet, el mapa
 * oscurecido, los controles de arriba y las cards se mueven como una sola pieza.
 */

/** Duración base de abrir/cerrar el sheet. */
export const ROUTE_SHEET_DURATION_MS = 360;

/** `cubic-bezier(0.22, 1, 0.36, 1)`: ease-out del mockup, rápido al salir y suave al llegar. */
export const ROUTE_SHEET_BEZIER = [0.22, 1, 0.36, 1] as const;

/** Retraso extra por cada parada de distancia a la card ancla al abrir. */
export const ROUTE_SHEET_STAGGER_MS = 40;

/** La opacidad de cada card entra más tarde que su movimiento, para que primero se lea el desplazamiento. */
export const ROUTE_SHEET_FADE_DELAY_MS = 80;

/** Al cerrar, las cards se apagan antes de que termine de bajar el sheet. */
export const ROUTE_SHEET_CLOSE_FADE_MS = Math.round(ROUTE_SHEET_DURATION_MS * 0.4);

/** Opacidad máxima del velo sobre el mapa con el sheet abierto. */
export const ROUTE_SHEET_DIM_OPACITY = 0.45;
