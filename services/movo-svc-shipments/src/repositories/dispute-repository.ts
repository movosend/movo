import { DisputeReason, DisputeStatus, ShipmentStatus } from "@movo/shared";
import type { DisputeOutcome, DisputePartyRole, DisputePaymentAction, DisputeStatementKind } from "@movo/shared";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { escapeLike, normalizedSql, normalizeSearchText, shipmentTextSearchSql } from "./admin-shipment-repository";

/**
 * MOVO-334 (DD-054): datos de la disputa que `updateStatus` crea en la misma transacción que la
 * transición a `disputed` (`UpdateStatusOptions.dispute`). `openedBy: null` es una disputa de
 * sistema (barrido).
 */
export interface NewDispute {
  /** Lo genera el caller cuando necesita el id para responder; si falta lo genera la DB. */
  id?: string;
  openedBy: string | null;
  openedByRole: DisputePartyRole | null;
  reason: DisputeReason;
  description: string;
  photoKeys?: string[];
}

/** MOVO-337 (DD-056): cómo se resolvió la disputa. Presente desde `resolving`. */
export interface DisputeResolutionRecord {
  outcome: DisputeOutcome;
  /** Porcentaje del preset; `null` con un monto libre o fuera de `partial`. */
  percentage: number | null;
  carrierAmountArs: number;
  senderAmountArs: number;
  paymentAction: DisputePaymentAction;
  reasoning: string;
  resolvedBy: string;
  /** `null` mientras la acción de pago no se haya confirmado (`resolving`). */
  resolvedAt: Date | null;
}

export interface DisputeRecord {
  id: string;
  shipmentId: string;
  openedBy: string | null;
  openedByRole: DisputePartyRole | null;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  openedAt: Date;
  resolution: DisputeResolutionRecord | null;
}

export interface BeginResolutionInput {
  disputeId: string;
  outcome: DisputeOutcome;
  percentage: number | null;
  carrierAmountArs: number;
  senderAmountArs: number;
  paymentAction: DisputePaymentAction;
  reasoning: string;
  resolvedBy: string;
}

/**
 * - `started`: estaba `open` y pasó a `resolving` con estos datos.
 * - `resumed`: ya estaba `resolving` (un intento anterior no confirmó el pago): `dispute` trae lo guardado.
 * - `already_resolved`: ya estaba `resolved`.
 */
export interface BeginResolutionResult {
  dispute: DisputeRecord;
  state: "started" | "resumed" | "already_resolved";
}

export interface DisputeSearch {
  reason?: DisputeReason;
  outcome?: DisputeOutcome;
  /** Código del envío (`MOVO-12345`, id o prefijo) o nombre de cualquiera de las partes. */
  q?: string;
  from?: Date;
  to?: Date;
  /** MOVO-341: ciudad del retiro del envío, coincidencia parcial sin distinguir mayúsculas ni tildes. */
  city?: string;
}

export interface DisputeListParams extends DisputeSearch {
  status?: DisputeStatus;
  /** Por fecha de apertura; por defecto `newest`. */
  sort?: "newest" | "oldest";
  limit: number;
  /** Id de la última disputa de la página anterior. */
  cursor?: string;
}

export interface DisputeListItem {
  dispute: DisputeRecord;
  shipment: {
    id: string;
    status: ShipmentStatus;
    senderId: string;
    carrierId: string | null;
    receiverId: string;
    pickupCity: string | null;
  };
  names: { sender: string | null; carrier: string | null; receiver: string | null };
  /** Estado del envío cuando se abrió la disputa (`fromStatus` del evento que lo pasó a `disputed`). */
  statusAtOpen: ShipmentStatus;
}

export class InvalidDisputeCursorError extends Error {
  constructor() {
    super("Cursor de paginación inválido");
    this.name = "InvalidDisputeCursorError";
  }
}

export interface DisputePhotoRecord {
  id: string;
  s3Key: string;
}

export interface DisputeStatementRecord {
  id: string;
  authorId: string;
  authorRole: DisputePartyRole;
  kind: DisputeStatementKind;
  text: string;
  createdAt: Date;
  photos: DisputePhotoRecord[];
}

export interface DisputeWithDetails extends DisputeRecord {
  /** Fotos de la apertura (sin descargo asociado). */
  photos: DisputePhotoRecord[];
  statements: DisputeStatementRecord[];
}

export interface AddDisputeStatementInput {
  disputeId: string;
  authorId: string;
  authorRole: DisputePartyRole;
  kind: DisputeStatementKind;
  text: string;
  photoKeys: string[];
}

/** Ya hay una disputa `open` sobre el envío (índice único parcial `disputes_shipment_open_key`). */
export class DisputeAlreadyOpenError extends Error {
  constructor(public readonly shipmentId: string) {
    super(`El envío '${shipmentId}' ya tiene una disputa abierta`);
    this.name = "DisputeAlreadyOpenError";
  }
}

/** La disputa ya no está `open` (la resolvió un admin, MOVO-34). */
export class DisputeNotOpenError extends Error {
  constructor(public readonly disputeId: string) {
    super(`La disputa '${disputeId}' no está abierta`);
    this.name = "DisputeNotOpenError";
  }
}

/** Segundo descargo de la misma parte, o segunda ampliación de quien abrió (único por disputa, autor y tipo). */
export class DisputeStatementAlreadySubmittedError extends Error {
  constructor(public readonly disputeId: string) {
    super(`Ya hay un descargo de esta parte en la disputa '${disputeId}'`);
    this.name = "DisputeStatementAlreadySubmittedError";
  }
}

/** Una de las fotos ya está asociada a una disputa (`dispute_photos.s3_key` es único). */
export class DisputePhotoAlreadyUsedError extends Error {
  constructor() {
    super("Una de las fotos ya está asociada a una disputa");
    this.name = "DisputePhotoAlreadyUsedError";
  }
}

/** MOVO-341: contadores sin filtros para el menú lateral y la home. */
export interface DisputeCounts {
  open: number;
  resolving: number;
  openOlderThan3Days: number;
  openOlderThan7Days: number;
}

export interface DisputePartyHistoryRecord {
  userId: string;
  opened: number;
  lost: number;
  open: number;
}

/** MOVO-341: la disputa más reciente de un envío, con lo mínimo que muestra el detalle del envío. */
export interface ShipmentDisputeSummaryRecord {
  shipmentId: string;
  disputeId: string;
  status: DisputeStatus;
  reason: DisputeReason;
  openedByRole: DisputePartyRole | null;
  openedAt: Date;
  statementsCount: number;
}

export interface DisputeRepository {
  findOpenByShipment(shipmentId: string): Promise<DisputeRecord | null>;
  /** La disputa más reciente del envío, en cualquier estado. */
  findLatestByShipment(shipmentId: string): Promise<DisputeRecord | null>;
  /**
   * MOVO-337: pasa la disputa de `open` a `resolving` guardando el resultado (con `FOR UPDATE`: dos admins a la
   * vez no se pisan). Si ya estaba `resolving` o `resolved` no modifica nada y devuelve lo guardado.
   * `null` si la disputa no existe.
   */
  beginResolution(input: BeginResolutionInput): Promise<BeginResolutionResult | null>;
  /**
   * MOVO-337: devuelve una disputa `resolving` a `open`, borrando el resultado guardado. Solo para cuando
   * `svc-payments` rechazó la acción antes de mover plata (un 4xx de negocio): así el admin puede resolver con
   * otros datos en vez de quedar atado a un resultado que no se puede ejecutar. `false` si ya no estaba `resolving`.
   */
  abortResolution(disputeId: string): Promise<boolean>;
  /** Una disputa con las partes del envío y el estado de origen, o `null`. */
  findListItem(id: string): Promise<DisputeListItem | null>;
  list(params: DisputeListParams): Promise<{ items: DisputeListItem[]; nextCursor: string | null }>;
  /** Cuántas disputas hay en cada estado con los mismos filtros de búsqueda. */
  statusCounts(search: DisputeSearch): Promise<Record<DisputeStatus, number>>;
  /** MOVO-341: abiertas, en resolución y abiertas hace más de 3 y 7 días. */
  counts(now?: Date): Promise<DisputeCounts>;
  /**
   * MOVO-341: por persona, cuántas disputas abrió, cuántas perdió (resueltas a favor de la contraparte; una
   * `partial` no cuenta) y cuántas tiene sin resolver (`open` o `resolving`) en cualquier rol.
   */
  partyHistory(userIds: string[]): Promise<DisputePartyHistoryRecord[]>;
  /** MOVO-341: la disputa más reciente de cada envío que tenga alguna. */
  latestSummaryByShipment(shipmentIds: string[]): Promise<Map<string, ShipmentDisputeSummaryRecord>>;
  /** Estado del envío cuando se abrió la disputa. */
  findStatusAtOpen(shipmentId: string): Promise<ShipmentStatus | null>;
  findById(id: string): Promise<DisputeWithDetails | null>;
  /** Lanza `DisputeNotOpenError`, `DisputeStatementAlreadySubmittedError` o `DisputePhotoAlreadyUsedError`. */
  addStatement(
    input: AddDisputeStatementInput,
  ): Promise<DisputeStatementRecord>;
  /** De las keys pedidas, las que ya están en alguna disputa. */
  findAssociatedPhotoKeys(keys: string[]): Promise<string[]>;
}

type DisputeRow = {
  id: string;
  shipmentId: string;
  openedBy: string | null;
  openedByRole: string | null;
  reason: string;
  description: string;
  status: string;
  openedAt: Date;
  outcome: string | null;
  resolutionPercentage: number | null;
  carrierAmountArs: { toNumber(): number } | null;
  senderAmountArs: { toNumber(): number } | null;
  paymentAction: string | null;
  reasoning: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
};

export function mapDisputeRow(row: DisputeRow): DisputeRecord {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    openedBy: row.openedBy,
    openedByRole: row.openedByRole as DisputePartyRole | null,
    reason: row.reason as DisputeReason,
    description: row.description,
    status: row.status as DisputeStatus,
    openedAt: row.openedAt,
    resolution:
      row.outcome && row.reasoning && row.resolvedBy && row.carrierAmountArs && row.senderAmountArs && row.paymentAction
        ? {
            outcome: row.outcome as DisputeOutcome,
            percentage: row.resolutionPercentage,
            carrierAmountArs: row.carrierAmountArs.toNumber(),
            senderAmountArs: row.senderAmountArs.toNumber(),
            paymentAction: row.paymentAction as DisputePaymentAction,
            reasoning: row.reasoning,
            resolvedBy: row.resolvedBy,
            resolvedAt: row.resolvedAt,
          }
        : null,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function searchConditions(search: DisputeSearch): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (search.reason) conditions.push(Prisma.sql`d.reason::text = ${search.reason}`);
  if (search.outcome) conditions.push(Prisma.sql`d.outcome::text = ${search.outcome}`);
  if (search.from) conditions.push(Prisma.sql`d.opened_at >= ${search.from}`);
  if (search.to) conditions.push(Prisma.sql`d.opened_at <= ${search.to}`);
  const text = shipmentTextSearchSql(search.q?.replace(/^#/, ""));
  if (text) conditions.push(text);
  const city = search.city ? normalizeSearchText(search.city) : "";
  if (city) {
    const like = `%${escapeLike(city)}%`;
    conditions.push(Prisma.sql`${normalizedSql("s.pickup_city")} LIKE ${like}`);
  }
  return conditions;
}

const FROM_SQL = Prisma.sql`
  FROM shipments.disputes d
  JOIN shipments.shipments s ON s.id = d.shipment_id
  LEFT JOIN shipments.user_display_names sn ON sn.user_id = s.sender_id
  LEFT JOIN shipments.user_display_names cn ON cn.user_id = s.carrier_id
  LEFT JOIN shipments.user_display_names rn ON rn.user_id = s.receiver_id`;

const whereOf = (conditions: Prisma.Sql[]): Prisma.Sql =>
  conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    (error as { code?: unknown }).code !== "P2002"
  ) {
    return false;
  }
  if (constraint === undefined) return true;
  // Prisma informa el índice violado en `meta.target` (nombre o columnas, según el driver).
  return JSON.stringify((error as { meta?: unknown }).meta ?? {}).includes(
    constraint,
  );
}

export function createDisputeRepository(db: PrismaClient): DisputeRepository {
  /** `fromStatus` del evento más reciente que pasó el envío a `disputed`. */
  async function statusAtOpenOf(shipmentIds: string[]): Promise<Map<string, ShipmentStatus>> {
    const events = await db.shipmentEvent.findMany({
      where: { shipmentId: { in: shipmentIds }, toStatus: ShipmentStatus.DISPUTED },
      orderBy: { createdAt: "asc" },
      select: { shipmentId: true, fromStatus: true },
    });
    const result = new Map<string, ShipmentStatus>();
    for (const event of events) {
      if (event.fromStatus) result.set(event.shipmentId, event.fromStatus as ShipmentStatus);
    }
    return result;
  }

  /** Las disputas pedidas, en el orden de `ids`, con las partes del envío, sus nombres y el estado de origen. */
  async function hydrate(ids: string[]): Promise<DisputeListItem[]> {
    const rows = await db.dispute.findMany({ where: { id: { in: ids } }, include: { shipment: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.shipment.senderId, row.shipment.carrierId, row.shipment.receiverId])),
    ].filter((id): id is string => id !== null);
    const [names, statusAtOpen] = await Promise.all([
      db.userDisplayName.findMany({ where: { userId: { in: userIds } } }),
      statusAtOpenOf([...new Set(rows.map((row) => row.shipmentId))]),
    ]);
    const nameOf = new Map(names.map((row) => [row.userId, row.name]));

    const items = ids.flatMap((id): DisputeListItem[] => {
      const row = byId.get(id);
      if (!row) return [];
      const { shipment } = row;
      return [
        {
          dispute: mapDisputeRow(row),
          shipment: {
            id: shipment.id,
            status: shipment.status as ShipmentStatus,
            senderId: shipment.senderId,
            carrierId: shipment.carrierId,
            receiverId: shipment.receiverId,
            pickupCity: shipment.pickupCity,
          },
          names: {
            sender: nameOf.get(shipment.senderId) ?? null,
            carrier: shipment.carrierId ? (nameOf.get(shipment.carrierId) ?? null) : null,
            receiver: nameOf.get(shipment.receiverId) ?? null,
          },
          statusAtOpen: statusAtOpen.get(row.shipmentId) ?? (shipment.status as ShipmentStatus),
        },
      ];
    });
    return items;
  }

  return {
    async findLatestByShipment(shipmentId) {
      const row = await db.dispute.findFirst({ where: { shipmentId }, orderBy: { openedAt: "desc" } });
      return row ? mapDisputeRow(row) : null;
    },

    async beginResolution(input) {
      return db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT "status"::text AS "status" FROM "shipments"."disputes" WHERE "id" = ${input.disputeId}::uuid FOR UPDATE`;
        const status = locked[0]?.status;
        if (!status) return null;
        if (status !== DisputeStatus.OPEN) {
          const row = await tx.dispute.findUniqueOrThrow({ where: { id: input.disputeId } });
          return {
            dispute: mapDisputeRow(row),
            state: status === DisputeStatus.RESOLVED ? ("already_resolved" as const) : ("resumed" as const),
          };
        }
        const row = await tx.dispute.update({
          where: { id: input.disputeId },
          data: {
            status: DisputeStatus.RESOLVING,
            outcome: input.outcome,
            resolutionPercentage: input.percentage,
            carrierAmountArs: new Prisma.Decimal(input.carrierAmountArs),
            senderAmountArs: new Prisma.Decimal(input.senderAmountArs),
            paymentAction: input.paymentAction,
            reasoning: input.reasoning,
            resolvedBy: input.resolvedBy,
          },
        });
        return { dispute: mapDisputeRow(row), state: "started" as const };
      });
    },

    async abortResolution(disputeId) {
      const result = await db.dispute.updateMany({
        where: { id: disputeId, status: DisputeStatus.RESOLVING },
        data: {
          status: DisputeStatus.OPEN,
          outcome: null,
          resolutionPercentage: null,
          carrierAmountArs: null,
          senderAmountArs: null,
          paymentAction: null,
          reasoning: null,
          resolvedBy: null,
        },
      });
      return result.count > 0;
    },

    async list(params) {
      if (params.cursor !== undefined && !UUID_PATTERN.test(params.cursor)) throw new InvalidDisputeCursorError();
      const conditions = searchConditions(params);
      if (params.status) conditions.push(Prisma.sql`d.status::text = ${params.status}`);
      const oldest = params.sort === "oldest";
      if (params.cursor) {
        const after = oldest ? Prisma.sql`>` : Prisma.sql`<`;
        conditions.push(
          Prisma.sql`(d.opened_at, d.id) ${after} (SELECT c.opened_at, c.id FROM shipments.disputes c WHERE c.id = ${params.cursor}::uuid)`,
        );
      }
      const order = oldest ? Prisma.sql`d.opened_at ASC, d.id ASC` : Prisma.sql`d.opened_at DESC, d.id DESC`;
      const ids = await db.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT d.id ${FROM_SQL} ${whereOf(conditions)} ORDER BY ${order} LIMIT ${params.limit + 1}`,
      );
      const pageIds = ids.slice(0, params.limit).map((row) => row.id);
      const nextCursor = ids.length > params.limit ? (pageIds[pageIds.length - 1] ?? null) : null;
      if (pageIds.length === 0) return { items: [], nextCursor: null };

      return { items: await hydrate(pageIds), nextCursor };
    },

    async findListItem(id) {
      if (!UUID_PATTERN.test(id)) return null;
      return (await hydrate([id]))[0] ?? null;
    },

    async statusCounts(search) {
      const rows = await db.$queryRaw<Array<{ status: string; total: bigint }>>(
        Prisma.sql`SELECT d.status::text AS status, COUNT(*) AS total ${FROM_SQL} ${whereOf(searchConditions(search))} GROUP BY d.status`,
      );
      const counts: Record<DisputeStatus, number> = {
        [DisputeStatus.OPEN]: 0,
        [DisputeStatus.RESOLVING]: 0,
        [DisputeStatus.RESOLVED]: 0,
      };
      for (const row of rows) counts[row.status as DisputeStatus] = Number(row.total);
      return counts;
    },

    async counts(now = new Date()) {
      const day = 24 * 60 * 60 * 1000;
      const [row] = await db.$queryRaw<Array<{ open: bigint; resolving: bigint; older3: bigint; older7: bigint }>>(
        Prisma.sql`SELECT
          COUNT(*) FILTER (WHERE d.status::text = 'open') AS open,
          COUNT(*) FILTER (WHERE d.status::text = 'resolving') AS resolving,
          COUNT(*) FILTER (WHERE d.status::text = 'open' AND d.opened_at < ${new Date(now.getTime() - 3 * day)}) AS older3,
          COUNT(*) FILTER (WHERE d.status::text = 'open' AND d.opened_at < ${new Date(now.getTime() - 7 * day)}) AS older7
          FROM shipments.disputes d`,
      );
      return {
        open: Number(row?.open ?? 0),
        resolving: Number(row?.resolving ?? 0),
        openOlderThan3Days: Number(row?.older3 ?? 0),
        openOlderThan7Days: Number(row?.older7 ?? 0),
      };
    },

    async partyHistory(userIds) {
      if (userIds.length === 0) return [];
      const rows = await db.$queryRaw<Array<{ userId: string; opened: bigint; lost: bigint; open: bigint }>>(
        Prisma.sql`SELECT u.user_id::text AS "userId",
          (SELECT COUNT(*) FROM shipments.disputes d WHERE d.opened_by = u.user_id) AS opened,
          (SELECT COUNT(*) FROM shipments.disputes d JOIN shipments.shipments s ON s.id = d.shipment_id
            WHERE d.status::text = 'resolved'
              AND ((d.outcome::text = 'carrier' AND s.sender_id = u.user_id)
                OR (d.outcome::text = 'sender' AND s.carrier_id = u.user_id))) AS lost,
          (SELECT COUNT(*) FROM shipments.disputes d JOIN shipments.shipments s ON s.id = d.shipment_id
            WHERE d.status::text IN ('open', 'resolving')
              AND (s.sender_id = u.user_id OR s.carrier_id = u.user_id OR s.receiver_id = u.user_id)) AS open
          FROM unnest(${userIds}::uuid[]) AS u(user_id)`,
      );
      return rows.map((row) => ({
        userId: row.userId,
        opened: Number(row.opened),
        lost: Number(row.lost),
        open: Number(row.open),
      }));
    },

    async latestSummaryByShipment(shipmentIds) {
      const result = new Map<string, ShipmentDisputeSummaryRecord>();
      if (shipmentIds.length === 0) return result;
      const rows = await db.$queryRaw<
        Array<{
          shipmentId: string;
          disputeId: string;
          status: string;
          reason: string;
          openedByRole: string | null;
          openedAt: Date;
          statements: bigint;
        }>
      >(
        Prisma.sql`SELECT DISTINCT ON (d.shipment_id)
          d.shipment_id::text AS "shipmentId", d.id::text AS "disputeId", d.status::text AS status, d.reason::text AS reason,
          d.opened_by_role::text AS "openedByRole", d.opened_at AS "openedAt",
          (SELECT COUNT(*) FROM shipments.dispute_statements st WHERE st.dispute_id = d.id) AS statements
          FROM shipments.disputes d
          WHERE d.shipment_id = ANY(${shipmentIds}::uuid[])
          ORDER BY d.shipment_id, d.opened_at DESC, d.id DESC`,
      );
      for (const row of rows) {
        result.set(row.shipmentId, {
          shipmentId: row.shipmentId,
          disputeId: row.disputeId,
          status: row.status as DisputeStatus,
          reason: row.reason as DisputeReason,
          openedByRole: row.openedByRole as DisputePartyRole | null,
          openedAt: row.openedAt,
          statementsCount: Number(row.statements),
        });
      }
      return result;
    },

    async findStatusAtOpen(shipmentId) {
      return (await statusAtOpenOf([shipmentId])).get(shipmentId) ?? null;
    },

    async findOpenByShipment(shipmentId) {
      const row = await db.dispute.findFirst({
        where: { shipmentId, status: DisputeStatus.OPEN },
      });
      return row ? mapDisputeRow(row) : null;
    },

    async findById(id) {
      const row = await db.dispute.findUnique({
        where: { id },
        include: {
          photos: {
            where: { statementId: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, s3Key: true },
          },
          statements: {
            orderBy: { createdAt: "asc" },
            include: {
              photos: {
                orderBy: { createdAt: "asc" },
                select: { id: true, s3Key: true },
              },
            },
          },
        },
      });
      if (!row) return null;
      return {
        ...mapDisputeRow(row),
        photos: row.photos,
        statements: row.statements.map((statement) => ({
          id: statement.id,
          authorId: statement.authorId,
          authorRole: statement.authorRole as DisputePartyRole,
          kind: statement.kind as DisputeStatementKind,
          text: statement.text,
          createdAt: statement.createdAt,
          photos: statement.photos,
        })),
      };
    },

    async addStatement(input) {
      try {
        return await db.$transaction(async (tx) => {
          // `FOR UPDATE`: una resolución concurrente (MOVO-34) espera a que este descargo commitee,
          // o este ve la disputa ya cerrada.
          const locked = await tx.$queryRaw<Array<{ status: string }>>`
            SELECT "status"::text AS "status" FROM "shipments"."disputes" WHERE "id" = ${input.disputeId}::uuid FOR UPDATE`;
          if (locked[0]?.status !== DisputeStatus.OPEN) {
            throw new DisputeNotOpenError(input.disputeId);
          }
          const statement = await tx.disputeStatement.create({
            data: {
              disputeId: input.disputeId,
              authorId: input.authorId,
              authorRole: input.authorRole,
              kind: input.kind,
              text: input.text,
              photos: {
                create: input.photoKeys.map((s3Key) => ({
                  disputeId: input.disputeId,
                  s3Key,
                })),
              },
            },
            include: {
              photos: {
                orderBy: { createdAt: "asc" },
                select: { id: true, s3Key: true },
              },
            },
          });
          return {
            id: statement.id,
            authorId: statement.authorId,
            authorRole: statement.authorRole as DisputePartyRole,
            kind: statement.kind as DisputeStatementKind,
            text: statement.text,
            createdAt: statement.createdAt,
            photos: statement.photos,
          };
        });
      } catch (error) {
        if (isUniqueViolation(error, "s3_key"))
          throw new DisputePhotoAlreadyUsedError();
        if (isUniqueViolation(error))
          throw new DisputeStatementAlreadySubmittedError(input.disputeId);
        throw error;
      }
    },

    async findAssociatedPhotoKeys(keys) {
      if (keys.length === 0) return [];
      const rows = await db.disputePhoto.findMany({
        where: { s3Key: { in: keys } },
        select: { s3Key: true },
      });
      return rows.map((row) => row.s3Key);
    },
  };
}
