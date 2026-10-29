import {
  ACTIVE_SHIPMENT_STATUSES,
  ADMIN_SHIPMENT_ALERT_STATUSES,
  ADMIN_SHIPMENT_GROUPS,
  ADMIN_SHIPMENT_GROUP_STATUSES,
  AdminShipmentCounts,
  AdminShipmentGroup,
  AdminShipmentPage,
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
  /** Solo los que llevan aviso (`isAdminShipmentAlert` de `@movo/shared`). */
  alert?: boolean;
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

/** Conteos de las pestañas, de cada estado y de los que llevan aviso por pestaña. */
export type AdminShipmentCountsResult = Pick<AdminShipmentPage, "counts" | "statusCounts" | "alertCounts">;

export interface AdminShipmentRepository {
  list(params: AdminShipmentListParams): Promise<{ items: AdminShipmentRecord[]; nextCursor: string | null }>;
  /** Conteos con los mismos filtros de búsqueda; `all` son los activos. */
  counts(search: AdminShipmentSearch): Promise<AdminShipmentCountsResult>;
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

export const normalizedSql = (column: string): Prisma.Sql =>
  Prisma.sql`lower(translate(${Prisma.raw(column)}, ${TRANSLATE_FROM}, ${TRANSLATE_TO}))`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Búsqueda de texto libre sobre un envío (`s`) y sus partes (`sn`/`cn`/`rn`), compartida por el listado de envíos y el de
 * disputas del panel. Acepta el código que muestra el panel (`MOVO-12345`, igual que `shipmentConfirmationCode`: los
 * últimos 5 dígitos del id sin guiones), los primeros 8 caracteres del id o el UUID completo, y el nombre de cualquiera
 * de las partes; `extraColumns` suma columnas de texto (direcciones).
 */
export function shipmentTextSearchSql(rawQuery: string | undefined, extraColumns: string[] = []): Prisma.Sql | null {
  let q = rawQuery ? normalizeSearchText(rawQuery.replace(/^#/, "")) : "";
  if (!q) return null;
  // El código visible son los primeros 8 caracteres del id: si pegan el UUID completo, se busca por ellos.
  if (UUID_PATTERN.test(q)) q = q.slice(0, 8);
  const like = `%${escapeLike(q)}%`;
  const alternatives = [
    Prisma.sql`lower(left(s.id::text, 8)) LIKE ${like}`,
    ...["sn.name", "cn.name", "rn.name", ...extraColumns].map((column) => Prisma.sql`${normalizedSql(column)} LIKE ${like}`),
  ];
  const code = /^(?:movo-?)?(\d{1,5})$/.exec(q);
  if (code?.[1]) {
    alternatives.push(
      Prisma.sql`right(regexp_replace(s.id::text, '[^0-9]', '', 'g'), 5) = ${code[1].padStart(5, "0")}`,
    );
  }
  return Prisma.sql`(${Prisma.join(alternatives, " OR ")})`;
}

/**
 * Último cambio de estado (o la creación), a ms: el cursor viaja en ISO y la base guarda µs.
 * Ojo: esta expresión no matchea `shipments_last_status_changed_at_idx` (que está sobre la columna cruda;
 * `date_trunc` sobre timestamptz es STABLE y no se puede indexar), así que hoy el listado hace seq scan + sort.
 * Con el volumen actual no molesta; si crece, hay que ordenar por la columna cruda y truncar solo el cursor.
 */
const SORT_KEY = Prisma.sql`date_trunc('milliseconds', COALESCE(s.last_status_changed_at, s.created_at))`;

/** Misma regla que `isAdminShipmentAlert`: un estado de aviso, o un `in_transit` demorado. */
const ALERT_SQL = Prisma.sql`(
  s.status::text = ANY(${[...ADMIN_SHIPMENT_ALERT_STATUSES]}::text[])
  OR (s.status::text = ${ShipmentStatus.IN_TRANSIT} AND s.transit_anomaly_flagged_at IS NOT NULL)
)`;

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

  const text = shipmentTextSearchSql(search.q, ["s.pickup_address", "s.delivery_address"]);
  if (text) conditions.push(text);

  if (search.alert) conditions.push(ALERT_SQL);

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
      const grouped = await db.$queryRaw<Array<{ status: string; count: number; alerts: number }>>`
        SELECT s.status::text AS status, COUNT(*)::int AS count, (COUNT(*) FILTER (WHERE ${ALERT_SQL}))::int AS alerts
        ${FROM_SQL}
        ${whereOf(searchConditions(search))}
        GROUP BY s.status`;
      const byStatus = new Map(grouped.map((entry) => [entry.status, entry]));

      const statusCounts = {} as AdminShipmentPage["statusCounts"];
      for (const status of Object.values(ShipmentStatus)) statusCounts[status] = byStatus.get(status)?.count ?? 0;

      const tally = (field: "count" | "alerts"): AdminShipmentCounts => {
        const total = (statuses: readonly ShipmentStatus[]) =>
          statuses.reduce((sum, status) => sum + (byStatus.get(status)?.[field] ?? 0), 0);
        const counts = { all: total(ACTIVE_SHIPMENT_STATUSES) } as AdminShipmentCounts;
        for (const group of ADMIN_SHIPMENT_GROUPS) {
          counts[group as AdminShipmentGroup] = total(ADMIN_SHIPMENT_GROUP_STATUSES[group]);
        }
        return counts;
      };
      return { counts: tally("count"), statusCounts, alertCounts: tally("alerts") };
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
