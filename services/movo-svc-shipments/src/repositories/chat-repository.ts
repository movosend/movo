import { PrismaClient } from "../generated/prisma/client";
import { ShipmentStatus } from "@movo/shared";
import { ChatReceiptState } from "../domain/chat-receipts";
import { ChatShipmentFacts } from "../domain/chat-window";

export interface ChatMessageRecord {
  id: string;
  shipmentId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  clientMessageId: string;
  moderated: boolean;
  createdAt: Date;
}

export interface NewChatMessage {
  shipmentId: string;
  authorId: string;
  authorName: string | null;
  /** Ya moderado: lo que se guarda es lo que ven todos. */
  body: string;
  clientMessageId: string;
  moderated: boolean;
}

/** Un envío con chat para la lista: lo mínimo para decidir el acceso y dibujar la fila. */
export interface ChatShipmentRow extends ChatShipmentFacts {
  id: string;
  pickupAddress: string;
  deliveryAddress: string;
  lastStatusChangedAt: Date | null;
}

export interface ChatRepository {
  /**
   * Guarda un mensaje. Idempotente por `(shipmentId, authorId, clientMessageId)`: reenviar el mismo
   * mensaje devuelve el ya guardado con `created: false` (la garantía vive en el índice único, no
   * en un chequeo previo).
   */
  create(input: NewChatMessage): Promise<{ message: ChatMessageRecord; created: boolean }>;
  /** El mensaje ya guardado con ese `clientMessageId` (reintento idempotente), o `null`. */
  findByClientMessageId(shipmentId: string, authorId: string, clientMessageId: string): Promise<ChatMessageRecord | null>;
  /** Del más reciente al más antiguo, con cursor keyset sobre `(createdAt, id)`. */
  listPage(
    shipmentId: string,
    limit: number,
    cursor?: string,
    /** Solo mensajes desde este instante (inicio de la última asignación); `null`/ausente = todos. */
    since?: Date | null
  ): Promise<{ items: ChatMessageRecord[]; nextCursor: string | null }>;
  /** Estado de entrega y lectura de cada integrante del envío que ya lo tiene. */
  listReceiptStates(shipmentId: string): Promise<ChatReceiptState[]>;
  /** Avanza (nunca retrocede) lo que `userId` recibió del chat. */
  markDelivered(shipmentId: string, userId: string, at: Date): Promise<void>;
  /** Avanza (nunca retrocede) lo que `userId` leyó; leer implica haber recibido. */
  markRead(shipmentId: string, userId: string, at: Date): Promise<void>;
  /** Idempotente: devuelve `created: false` si ya había reportado esta conversación. */
  createReport(shipmentId: string, reporterId: string): Promise<{ created: boolean }>;
  hasReport(shipmentId: string, reporterId: string): Promise<boolean>;
  /** Envíos con chat visible para `userId`, el de actividad más reciente primero (último mensaje o cambio de estado). */
  listShipmentsForUser(userId: string, statuses: readonly ShipmentStatus[], limit: number): Promise<ChatShipmentRow[]>;
  /** El último mensaje de cada envío (los envíos sin mensajes no aparecen). */
  lastMessages(shipmentIds: readonly string[]): Promise<Map<string, ChatMessageRecord>>;
  /**
   * Mensajes ajenos posteriores a lo último que `userId` leyó, por envío. No cuenta los de
   * `excludeAuthorIds` (quienes tienen un bloqueo con `userId`: no ve esos mensajes).
   */
  unreadCounts(userId: string, shipmentIds: readonly string[], excludeAuthorIds: readonly string[]): Promise<Map<string, number>>;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Cursor opaco: base64 de `${createdAt ISO}|${id}`, mismo criterio que `rating-repository.ts`. */
function encodeCursor(message: ChatMessageRecord): string {
  return Buffer.from(`${message.createdAt.toISOString()}|${message.id}`, "utf8").toString("base64");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [createdAtRaw, id] = Buffer.from(cursor, "base64").toString("utf8").split("|");
  const createdAt = new Date(createdAtRaw ?? "");
  // El id va contra una columna `uuid`: uno que no lo es haría fallar la query con un 500 en vez de un 400.
  if (!id || !UUID_RE.test(id) || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

export class InvalidChatCursorError extends Error {
  constructor() {
    super("Cursor de paginación inválido");
    this.name = "InvalidChatCursorError";
  }
}

interface LastMessageRow {
  id: string;
  shipment_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  client_message_id: string;
  moderated: boolean;
  created_at: Date;
}

export function createChatRepository(db: PrismaClient): ChatRepository {
  return {
    async create(input) {
      try {
        // `createdAt` lo fija la app (precisión de ms): con el default de Postgres (µs) el cursor,
        // que viaja como ISO en ms, saltearía mensajes que comparten el mismo milisegundo.
        const message = await db.chatMessage.create({ data: { ...input, createdAt: new Date() } });
        return { message, created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await db.chatMessage.findUnique({
          where: {
            shipmentId_authorId_clientMessageId: {
              shipmentId: input.shipmentId,
              authorId: input.authorId,
              clientMessageId: input.clientMessageId,
            },
          },
        });
        if (!existing) throw error;
        return { message: existing, created: false };
      }
    },

    async findByClientMessageId(shipmentId, authorId, clientMessageId) {
      return db.chatMessage.findUnique({
        where: { shipmentId_authorId_clientMessageId: { shipmentId, authorId, clientMessageId } },
      });
    },

    async listPage(shipmentId, limit, cursor, since) {
      const cursorFilter = cursor ? decodeCursor(cursor) : null;
      if (cursor && !cursorFilter) throw new InvalidChatCursorError();
      const rows = await db.chatMessage.findMany({
        where: {
          shipmentId,
          ...(since ? { createdAt: { gte: since } } : {}),
          ...(cursorFilter
            ? {
                OR: [
                  { createdAt: { lt: cursorFilter.createdAt } },
                  { createdAt: cursorFilter.createdAt, id: { lt: cursorFilter.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        // Pide una de más para saber si hay otra página sin una segunda query.
        take: limit + 1,
      });
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
    },

    async listReceiptStates(shipmentId) {
      const rows = await db.chatParticipantState.findMany({ where: { shipmentId } });
      return rows.map((r) => ({ userId: r.userId, lastDeliveredAt: r.lastDeliveredAt, lastReadAt: r.lastReadAt }));
    },

    async markDelivered(shipmentId, userId, at) {
      // GREATEST: los instantes solo avanzan aunque lleguen dos marcas fuera de orden.
      await db.$executeRaw`
        INSERT INTO shipments.chat_participant_states (shipment_id, user_id, last_delivered_at)
        VALUES (${shipmentId}::uuid, ${userId}::uuid, ${at})
        ON CONFLICT (shipment_id, user_id) DO UPDATE
          SET last_delivered_at = GREATEST(shipments.chat_participant_states.last_delivered_at, EXCLUDED.last_delivered_at)`;
    },

    async markRead(shipmentId, userId, at) {
      await db.$executeRaw`
        INSERT INTO shipments.chat_participant_states (shipment_id, user_id, last_delivered_at, last_read_at)
        VALUES (${shipmentId}::uuid, ${userId}::uuid, ${at}, ${at})
        ON CONFLICT (shipment_id, user_id) DO UPDATE SET
          last_delivered_at = GREATEST(shipments.chat_participant_states.last_delivered_at, EXCLUDED.last_delivered_at),
          last_read_at = GREATEST(shipments.chat_participant_states.last_read_at, EXCLUDED.last_read_at)`;
    },

    async createReport(shipmentId, reporterId) {
      try {
        await db.chatReport.create({ data: { shipmentId, reporterId } });
        return { created: true };
      } catch (error) {
        if (isUniqueViolation(error)) return { created: false };
        throw error;
      }
    },

    async hasReport(shipmentId, reporterId) {
      return (await db.chatReport.count({ where: { shipmentId, reporterId } })) > 0;
    },

    async listShipmentsForUser(userId, statuses, limit) {
      // Los más recientes por ACTIVIDAD (último mensaje o último cambio de estado), no solo por estado: con más
      // de `limit` envíos, un chat activo de un envío viejo no puede quedar afuera. El orden se resuelve en SQL
      // y los envíos sin marca de tiempo cuentan como los más viejos (no como los primeros, que es lo que hace
      // Postgres con los NULL en un DESC).
      const ids = await db.$queryRaw<Array<{ id: string }>>`
        SELECT s.id
        FROM shipments.shipments s
        LEFT JOIN LATERAL (
          SELECT MAX(m.created_at) AS last_message_at FROM shipments.chat_messages m
          WHERE m.shipment_id = s.id AND (s.chat_started_at IS NULL OR m.created_at >= s.chat_started_at)
        ) lm ON TRUE
        WHERE s.status::text = ANY(${[...statuses]}::text[])
          AND s.carrier_id IS NOT NULL
          AND (
            s.sender_id = ${userId}::uuid
            OR s.receiver_id = ${userId}::uuid
            OR s.carrier_id = ${userId}::uuid
            OR EXISTS (
              SELECT 1 FROM shipments.receiver_transfer_requests t
              WHERE t.shipment_id = s.id AND t.requested_by = ${userId}::uuid AND t.status::text = 'completed'
            )
          )
        ORDER BY GREATEST(
          COALESCE(lm.last_message_at, 'epoch'::timestamptz),
          COALESCE(s.last_status_changed_at, 'epoch'::timestamptz)
        ) DESC, s.id DESC
        LIMIT ${limit}`;
      if (ids.length === 0) return [];
      const found = await db.shipment.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        select: {
          id: true,
          status: true,
          senderId: true,
          receiverId: true,
          carrierId: true,
          deliveredAt: true,
          pickupAddress: true,
          deliveryAddress: true,
          lastStatusChangedAt: true,
          receiverTransfers: { where: { status: "completed" }, select: { requestedBy: true }, take: 1 },
        },
      });
      const byId = new Map(found.map((r) => [r.id, r]));
      const rows = ids.map((r) => byId.get(r.id)).filter((r): r is NonNullable<typeof r> => r !== undefined);
      return rows.map((r) => ({
        id: r.id,
        status: r.status as ShipmentStatus,
        senderId: r.senderId,
        receiverId: r.receiverId,
        carrierId: r.carrierId,
        deliveredAt: r.deliveredAt,
        pickupAddress: r.pickupAddress,
        deliveryAddress: r.deliveryAddress,
        lastStatusChangedAt: r.lastStatusChangedAt,
        formerReceiverId: r.receiverTransfers[0]?.requestedBy ?? null,
      }));
    },

    async lastMessages(shipmentIds) {
      const map = new Map<string, ChatMessageRecord>();
      if (shipmentIds.length === 0) return map;
      const rows = await db.$queryRaw<LastMessageRow[]>`
        SELECT DISTINCT ON (m.shipment_id) m.id, m.shipment_id, m.author_id, m.author_name, m.body, m.client_message_id, m.moderated, m.created_at
        FROM shipments.chat_messages m
        JOIN shipments.shipments sh ON sh.id = m.shipment_id
        WHERE m.shipment_id = ANY(${[...shipmentIds]}::uuid[])
          AND (sh.chat_started_at IS NULL OR m.created_at >= sh.chat_started_at)
        ORDER BY m.shipment_id, m.created_at DESC, m.id DESC`;
      for (const r of rows) {
        map.set(r.shipment_id, {
          id: r.id,
          shipmentId: r.shipment_id,
          authorId: r.author_id,
          authorName: r.author_name,
          body: r.body,
          clientMessageId: r.client_message_id,
          moderated: r.moderated,
          createdAt: r.created_at,
        });
      }
      return map;
    },

    async unreadCounts(userId, shipmentIds, excludeAuthorIds) {
      const map = new Map<string, number>();
      if (shipmentIds.length === 0) return map;
      const rows = await db.$queryRaw<Array<{ shipment_id: string; n: number }>>`
        SELECT m.shipment_id, COUNT(*)::int AS n
        FROM shipments.chat_messages m
        JOIN shipments.shipments sh ON sh.id = m.shipment_id
        LEFT JOIN shipments.chat_participant_states s
          ON s.shipment_id = m.shipment_id AND s.user_id = ${userId}::uuid
        WHERE m.shipment_id = ANY(${[...shipmentIds]}::uuid[])
          AND (sh.chat_started_at IS NULL OR m.created_at >= sh.chat_started_at)
          AND m.author_id <> ${userId}::uuid
          AND NOT (m.author_id = ANY(${[...excludeAuthorIds]}::uuid[]))
          AND (s.last_read_at IS NULL OR m.created_at > s.last_read_at)
        GROUP BY m.shipment_id`;
      for (const r of rows) map.set(r.shipment_id, r.n);
      return map;
    },
  };
}
