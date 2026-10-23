/** Código corto de un envío en el panel: los 8 primeros caracteres del UUID (no hay otro código de envío). */
export const shortShipmentId = (id: string): string => id.slice(0, 8).toUpperCase();
