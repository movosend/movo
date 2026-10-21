import { isTourId, type UserTourRecord } from "@movo/shared/dist/config/tours";
import { SECURE_STORE_KEYS, secureStore } from "./secure-store";

/**
 * MOVO-169: registros de tours que el backend todavía no confirmó. Se guardan antes del
 * `PUT` y se borran cuando responde, así un `PUT` que falla (sin red, app cerrada a mitad)
 * se reintenta en el próximo arranque y, mientras tanto, el tour no vuelve a aparecer.
 */
function keyFor(userId: string): string {
  return `${SECURE_STORE_KEYS.pendingTourRecordsPrefix}.${userId}`;
}

function isTourRecord(value: unknown): value is UserTourRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tourId === "string" &&
    isTourId(record.tourId) &&
    typeof record.version === "number" &&
    (record.outcome === "completed" || record.outcome === "skipped")
  );
}

export async function readPendingTours(userId: string): Promise<UserTourRecord[]> {
  try {
    const raw = await secureStore.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTourRecord) : [];
  } catch {
    return [];
  }
}

async function writePendingTours(userId: string, records: UserTourRecord[]): Promise<void> {
  if (records.length === 0) {
    await secureStore.deleteItem(keyFor(userId));
    return;
  }
  await secureStore.setItem(keyFor(userId), JSON.stringify(records));
}

export async function addPendingTour(userId: string, record: UserTourRecord): Promise<void> {
  const current = await readPendingTours(userId);
  await writePendingTours(userId, [...current.filter((item) => item.tourId !== record.tourId), record]);
}

export async function removePendingTour(userId: string, tourId: UserTourRecord["tourId"]): Promise<void> {
  const current = await readPendingTours(userId);
  await writePendingTours(userId, current.filter((item) => item.tourId !== tourId));
}
