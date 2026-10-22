/**
 * Cursor opaco de paginación keyset sobre `(createdAt, id)`: base64 de `${createdAt ISO}|${id}`.
 * Lo comparten el chat del envío y el soporte (MOVO-320); mismo criterio que `rating-repository.ts`.
 */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `null` si el cursor no es válido (el caller responde 400). */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [createdAtRaw, id] = Buffer.from(cursor, "base64").toString("utf8").split("|");
  const createdAt = new Date(createdAtRaw ?? "");
  // El id va contra una columna `uuid`: uno que no lo es haría fallar la query con un 500 en vez de un 400.
  if (!id || !UUID_RE.test(id) || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}
