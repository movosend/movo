import {
  ACTIVE_SHIPMENT_STATUSES,
  ADMIN_SHIPMENT_GROUPS,
  ADMIN_SHIPMENT_GROUP_STATUSES,
  AdminShipmentCounts,
  AdminShipmentGroup,
  ShipmentStatus,
} from "@movo/shared";
import { Prisma, PrismaClient, Shipment as ShipmentRow } from "../generated/prisma/client";

/** Filtros de búsqueda, comunes al listado y a los conteos de las pestañas. */
export interface AdminShipmentSearch {
  /** Ciudad del retiro, sin distinguir tildes ni mayúsculas. */
  city?: string;
  /** Rango sobre el último cambio de estado. */
  from?: Date;
  to?: Date;
  /** Código, nombre de cualquiera de las partes o dirección. */
  q?: string;
}

export interface AdminShipmentListParams extends AdminShipmentSearch {
  /** Estados a listar; por defecto, los activos. */
  statuses: readonly ShipmentStatus[];
  limit: number;
  cursor?: string;
}

/** Envío tal cual está guardado, con los nombres conocidos de sus partes. */
export interface AdminShipmentRecord {
  row: ShipmentRow;
  names: { sender: string | null; carrier: string | null; receiver: string | null };
}

export interface AdminShipmentRepository {
  list(params: AdminShipmentListParams): Promise<{ items: AdminShipmentRecord[]; nextCursor: string | null }>;
  /** Conteo de cada pestaña con los mismos filtros de búsqueda; `all` son los activos. */
  counts(search: AdminShipmentSearch): Promise<AdminShipmentCounts>;
  findRecord(id: string): Promise<AdminShipmentRecord | null>;
  /** Ids de usuarios sin nombre conocido, para completarlos desde svc-users. */
  findMissingNames(records: AdminShipmentRecord[]): Promise<string[]>;
  listChatReports(shipmentId: string): Promise<Array<{ reporterId: string; createdAt: Date }>>;
}

export class InvalidAdminCursorError extends Error {
  constructor() {
    super("Cursor de paginación inválido");
    this.name = "InvalidAdminCursorError";
  }
}

// Letras con tilde (y la ñ) -> su letra base. Postgres no trae `unaccent` sin instalar una extensión,
// y `translate` alcanza para el español.
const ACCENTED_TO_PLAIN: ReadonlyArray<readonly [string, string]> = [
  ["áàäâãÁÀÄÂÃ", "a"],
  ["éèëêÉÈËÊ", "e"],
  ["íìïîÍÌÏÎ", "i"],
  ["óòöôõÓÒÖÔÕ", "o"],
  ["úùüûÚÙÜÛ", "u"],
  ["ñÑ", "n"],
  ["çÇ", "c"],
];
const TRANSLATE_FROM = ACCENTED_TO_PLAIN.map(([accented]) => accented).join("");
const TRANSLATE_TO = ACCENTED_TO_PLAIN.map(([accented, plain]) => plain.repeat([...accented].length)).join("");

/** Minúsculas y sin tildes: lo que se compara contra `normalizedSql`. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

const normalizedSql = (column: string): Prisma.Sql =>
  Prisma.sql`lower(translate(${Prisma.raw(column)}, ${TRANSLATE_FROM}, ${TRANSLATE_TO}))`;

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Último cambio de estado (o la creación), a ms: el cursor viaja en ISO y la base guarda µs. */
const SORT_KEY = Prisma.sql`date_trunc('milliseconds', COALESCE(s.last_status_changed_at, s.created_at))`;

const FROM_SQL = Prisma.sql`
  FROM shipments.shipments s
  LEFT JOIN shipments.user_display_names sn ON sn.user_id = s.sender_id
  LEFT JOIN shipments.user_display_names cn ON cn.user_id = s.carrier_id
  LEFT JOIN shipments.user_display_names rn ON rn.user_id = s.receiver_id`;

function searchConditions(search: AdminShipmentSearch): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  const city = search.city ? normalizeSearchText(search.city) : "";
  if (city) conditions.push(Prisma.sql`${normalizedSql("s.pickup_city")} = ${city}`);

  if (search.from) conditions.push(Prisma.sql`${SORT_KEY} >= ${search.from}`);
  if (search.to) conditions.push(Prisma.sql`${SORT_KEY} <= ${search.to}`);

  const q = search.q ? normalizeSearchText(search.q.replace(/^#/, "")) : "";
  if (q) {
    const like = `%${escapeLike(q)}%`;
    conditions.push(Prisma.sql`(
      lower(left(s.id::text, 8)) LIKE ${like}
      OR ${normalizedSql("sn.name")} LIKE ${like}
      OR ${normalizedSql("cn.name")} LIKE ${like}
      OR ${normalizedSql("rn.name")} LIKE ${like}
      OR ${normalizedSql("s.pickup_address")} LIKE ${like}
      OR ${normalizedSql("s.delivery_address")} LIKE ${like}
    )`);
  }

  return conditions;
}

const whereOf = (conditions: Prisma.Sql[]): Prisma.Sql =>
  conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

function encodeCursor(sortKey: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: sortKey.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    const t = typeof parsed.t === "string" ? new Date(parsed.t) : null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!t || Number.isNaN(t.getTime()) || typeof parsed.id !== "string" || !uuid.test(parsed.id)) {
      throw new InvalidAdminCursorError();
    }
    return { t, id: parsed.id };
  } catch {
    throw new InvalidAdminCursorError();
  }
}

export function createAdminShipmentRepository(db: PrismaClient): AdminShipmentRepository {
  async function namesOf(rows: ShipmentRow[]): Promise<Map<string, string>> {
    const userIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.senderId);
      userIds.add(row.receiverId);
      if (row.carrierId) userIds.add(row.carrierId);
    }
    const found = await db.userDisplayName.findMany({ where: { userId: { in: [...userIds] } } });
    return new Map(found.map((entry) => [entry.userId, entry.name]));
  }

  const toRecord = (row: ShipmentRow, names: Map<string, string>): AdminShipmentRecord => ({
    row,
    names: {
      sender: names.get(row.senderId) ?? null,
      carrier: row.carrierId ? (names.get(row.carrierId) ?? null) : null,
      receiver: names.get(row.receiverId) ?? null,
    },
  });

  return {
    async list(params) {
      const conditions = searchConditions(params);
      conditions.push(Prisma.sql`s.status::text = ANY(${[...params.statuses]}::text[])`);
      if (params.cursor) {
        const cursor = decodeCursor(params.cursor);
        conditions.push(Prisma.sql`(${SORT_KEY} < ${cursor.t} OR (${SORT_KEY} = ${cursor.t} AND s.id < ${cursor.id}::uuid))`);
      }

      const keyed = await db.$queryRaw<Array<{ id: string; sort_key: Date }>>`
        SELECT s.id::text AS id, ${SORT_KEY} AS sort_key
        ${FROM_SQL}
        ${whereOf(conditions)}
        ORDER BY ${SORT_KEY} DESC, s.id DESC
        LIMIT ${params.limit + 1}`;

      const page = keyed.slice(0, params.limit);
      const rows = await db.shipment.findMany({ where: { id: { in: page.map((entry) => entry.id) } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const names = await namesOf(rows);

      const items = page.flatMap((entry) => {
        const row = byId.get(entry.id);
        return row ? [toRecord(row, names)] : [];
      });
      const last = page[page.length - 1];
      return { items, nextCursor: keyed.length > params.limit && last ? encodeCursor(last.sort_key, last.id) : null };
    },

    async counts(search) {
      const grouped = await db.$queryRaw<Array<{ status: string; count: number }>>`
        SELECT s.status::text AS status, COUNT(*)::int AS count
        ${FROM_SQL}
        ${whereOf(searchConditions(search))}
        GROUP BY s.status`;
      const byStatus = new Map(grouped.map((entry) => [entry.status, entry.count]));
      const total = (statuses: readonly ShipmentStatus[]) =>
        statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);

      const counts = { all: total(ACTIVE_SHIPMENT_STATUSES) } as AdminShipmentCounts;
      for (const group of ADMIN_SHIPMENT_GROUPS) {
        counts[group as AdminShipmentGroup] = total(ADMIN_SHIPMENT_GROUP_STATUSES[group]);
      }
      return counts;
    },

    async findRecord(id) {
      const row = await db.shipment.findUnique({ where: { id } });
      if (!row) return null;
      return toRecord(row, await namesOf([row]));
    },

    async findMissingNames(records) {
      const missing = new Set<string>();
      for (const { row, names } of records) {
        if (!names.sender) missing.add(row.senderId);
        if (!names.receiver) missing.add(row.receiverId);
        if (row.carrierId && !names.carrier) missing.add(row.carrierId);
      }
      return [...missing];
    },

    async listChatReports(shipmentId) {
      const reports = await db.chatReport.findMany({
        where: { shipmentId },
        orderBy: { createdAt: "asc" },
        select: { reporterId: true, createdAt: true },
      });
      return reports;
    },
  };
}
