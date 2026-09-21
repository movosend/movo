import { secureStore, SECURE_STORE_KEYS } from "./secure-store";

/**
 * Fallback in-app del aviso de viaje auto-creado (MOVO-236, AC2): sin token push
 * registrado, la única forma de detectar "se armó un viaje nuevo a partir de un envío"
 * es comparar los `tripId`s de "Mis viajes" contra los que este dispositivo ya vio —
 * un `Trip` auto-creado es indistinguible de uno declarado a mano (AC3), no hay ningún
 * flag del backend que lo marque.
 */

async function readSeenTripIds(): Promise<string[] | null> {
  const raw = await secureStore.getItem(SECURE_STORE_KEYS.carrierSeenTripIds);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

async function writeSeenTripIds(ids: readonly string[]): Promise<void> {
  await secureStore.setItem(SECURE_STORE_KEYS.carrierSeenTripIds, JSON.stringify(ids));
}

/**
 * Marca un `tripId` puntual como visto (MOVO-236: llamado por `useCreateTrip` al
 * declarar un viaje a mano, ANTES de que "Mis viajes" llegue a diffearlo) — así el
 * flujo de "Declarar viaje" (que ya tiene su propio aviso, `?created=1`) nunca dispara
 * también el banner de auto-creado para ese mismo viaje.
 */
export async function markTripAsSeen(tripId: string): Promise<void> {
  const seen = (await readSeenTripIds()) ?? [];
  if (seen.includes(tripId)) return;
  await writeSeenTripIds([...seen, tripId]);
}

export interface DiffSeenTripsResult {
  /** `tripId`s presentes en `currentTripIds` que no estaban en el set persistido. */
  newTripIds: string[];
}

/**
 * Compara `currentTripIds` (lo que devolvió `GET /trips` recién) contra el set
 * persistido y lo actualiza para incluir a todos. Primera vez que corre en este
 * dispositivo (set nunca inicializado): siembra sin reportar ningún `newTripIds`,
 * para no disparar el banner sobre viajes que el transportista ya conocía de antes de
 * esta feature.
 */
export async function diffAndMarkSeenTrips(currentTripIds: readonly string[]): Promise<DiffSeenTripsResult> {
  const seen = await readSeenTripIds();
  if (seen === null) {
    await writeSeenTripIds(currentTripIds);
    return { newTripIds: [] };
  }
  const seenSet = new Set(seen);
  const newTripIds = currentTripIds.filter((id) => !seenSet.has(id));
  if (newTripIds.length > 0) {
    await writeSeenTripIds([...seen, ...newTripIds]);
  }
  return { newTripIds };
}
