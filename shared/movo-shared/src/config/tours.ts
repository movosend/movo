/**
 * MOVO-169: catálogo de tours del tutorial in-app (coach marks), compartido entre
 * `movo-svc-users` (persiste qué tour vio cada usuario, `users.user_tour`) y
 * `movo-mobile` (decide si dispara cada tour).
 *
 * El `id` es un string libre validado acá en código, no un enum de Postgres -- mismo
 * criterio que `NOTIFICATION_CATEGORIES`: sumar un tour nuevo es agregar una entrada a
 * `TOUR_IDS`, sin `ALTER TYPE`. `outcome` permite medir la tasa de omisión de cada tour.
 */
export const TOUR_IDS = ["first_steps", "carrier"] as const;
export type TourId = (typeof TOUR_IDS)[number];

export const TOUR_OUTCOMES = ["completed", "skipped"] as const;
export type TourOutcome = (typeof TOUR_OUTCOMES)[number];

export function isTourId(value: string): value is TourId {
  return (TOUR_IDS as readonly string[]).includes(value);
}

/**
 * Registro de un tour visto (`GET /users/me` → `tours`, `PUT /users/me/tours/:tourId`).
 * El cliente vuelve a mostrar un tour automáticamente solo si su versión local es
 * mayor a `version` (cambios grandes de la app); un relanzamiento manual desde "Ayuda
 * y soporte" no escribe este registro.
 */
export interface UserTourRecord {
  tourId: TourId;
  version: number;
  outcome: TourOutcome;
}
