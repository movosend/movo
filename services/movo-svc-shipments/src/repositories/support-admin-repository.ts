import {
  SupportInternalCounts,
  SupportInternalCountsQuery,
  SupportInternalListQuery,
  SupportPriority,
  SupportStatus,
  SupportTag,
  SupportTopic,
  SupportUserHistoryItem,
  formatSupportCode,
} from "@movo/shared";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { SupportAdminConversationFacts, supportEventText } from "../domain/support-admin-rules";
import { SupportMessageFacts, SupportMessageKindValue } from "../domain/support-rules";
import { decodeCursor, encodeCursor } from "../utils/cursor";
import { claimSupportAttachments } from "./support-attachment-repository";

/**
 * MOVO-322: datos de la bandeja de soporte del lado del agente. El lado del usuario sigue en `support-repository.ts`;
 * acá están las lecturas con todos los `kind` y las escrituras del equipo (responder, nota, asignar, resolver...).
 * Cada escritura bloquea la fila de la conversación (`FOR UPDATE`), como `appendUserMessage`: un agente y el usuario
 * escribiendo a la vez no se pisan el estado.
 */

export type SupportAdminConversationRecord = SupportAdminConversationFacts;

export interface SupportAdminRow {
  conversation: SupportAdminConversationRecord;
  lastMessage: SupportMessageFacts | null;
  unread: number;
}

export class InvalidSupportAdminCursorError extends Error {
  constructor() {
    super("Cursor de paginación inválido");
    this.name = "InvalidSupportAdminCursorError";
  }
}

export interface AgentMessageInput {
  conversationId: string;
  agentId: string;
  agentFirstName: string;
  agentFullName: string;
  /** Ya recortado; vacío solo con adjuntos. */
  body: string;
  clientMessageId: string;
  internal: boolean;
  attachmentIds: string[];
  now: Date;
}

export interface AgentMessageResult {
  message: SupportMessageFacts;
  /** Eventos del equipo que generó la respuesta (reapertura, "tomó la conversación"). */
  events: SupportMessageFacts[];
  conversation: SupportAdminConversationRecord;
  created: boolean;
  statusChanged: boolean;
}

export interface ConversationPatchInput {
  conversationId: string;
  actorId: string;
  actorFullName: string;
  /** `undefined`: no cambia; `null`: desasigna. */
  assignedTo?: string | null;
  assigneeFullName?: string;
  priority?: SupportPriority;
  topic?: SupportTopic;
  tags?: SupportTag[];
  /** `undefined`: no cambia; `null`: desvincula. Ya validado (el usuario es parte del envío). */
  shipmentId?: string | null;
  now: Date;
}

export interface StaffChangeResult {
  conversation: SupportAdminConversationRecord;
  events: SupportMessageFacts[];
  changed: boolean;
}

export interface SupportAdminRepository {
  list(query: SupportInternalListQuery, limit: number): Promise<{ items: SupportAdminRow[]; nextCursor: string | null }>;
  counts(query: SupportInternalCountsQuery): Promise<SupportInternalCounts>;
  findRow(id: string): Promise<SupportAdminRow | null>;
  /** Todos los `kind`, del más reciente al más antiguo. */
  listMessages(conversationId: string, limit: number, cursor?: string): Promise<{ items: SupportMessageFacts[]; nextCursor: string | null }>;
  /** El mensaje del equipo con ese `clientMessageId` en la conversación (reenvío idempotente), o `null`. */
  findStaffMessageByClientId(conversationId: string, clientMessageId: string): Promise<SupportMessageFacts | null>;
  agentLoads(): Promise<Array<{ agentId: string; activeCount: number }>>;
  userConversations(userId: string, excludeId: string, limit: number): Promise<SupportUserHistoryItem[]>;
  appendAgentMessage(input: AgentMessageInput): Promise<AgentMessageResult>;
  applyPatch(input: ConversationPatchInput): Promise<StaffChangeResult>;
  setResolved(input: { conversationId: string; actorId: string; actorFullName: string; resolved: boolean; now: Date }): Promise<StaffChangeResult>;
}

const PRIORITY_RANK_SQL = Prisma.sql`CASE c.priority::text WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;

interface ListCursor {
  r?: number;
  t: string;
  i: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeListCursor(raw: string, withRank: boolean): ListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<ListCursor>;
    const validRank = !withRank || (typeof parsed.r === "number" && Number.isInteger(parsed.r));
    if (validRank && typeof parsed.t === "string" && !Number.isNaN(new Date(parsed.t).getTime()) && typeof parsed.i === "string" && UUID_RE.test(parsed.i)) {
      return parsed as ListCursor;
    }
  } catch {
    // cae al error de abajo
  }
  throw new InvalidSupportAdminCursorError();
}

/** `%` y `_` de la búsqueda son literales, no comodines de `ILIKE`. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Búsqueda de la bandeja (AC2): código `SOP-NNNN`, código del envío vinculado (`MOVO-48176`), texto de cualquier
 * mensaje (notas incluidas: las lee el equipo) o un usuario cuyo nombre coincide (`userIds`, de `svc-users`).
 */
function searchSql(q: string | undefined, userIds: string[] | undefined): Prisma.Sql | null {
  const text = q?.trim();
  if (!text) return null;
  const parts: Prisma.Sql[] = [
    Prisma.sql`EXISTS (SELECT 1 FROM shipments.support_messages m WHERE m.conversation_id = c.id AND m.body ILIKE ${likePattern(text)})`,
  ];
  const code = /^(?:sop-?)?(\d{1,9})$/i.exec(text);
  if (code) parts.push(Prisma.sql`c.code_number = ${Number(code[1])}`);
  const shipment = /^#?(?:movo-?)?(\d{5})$/i.exec(text);
  if (shipment) {
    parts.push(Prisma.sql`right(regexp_replace(c.shipment_id::text, '\\D', '', 'g'), 5) = ${shipment[1]}`);
  }
  if (userIds && userIds.length > 0) parts.push(Prisma.sql`c.user_id = ANY(${userIds}::uuid[])`);
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

function assigneeSql(assignee: string | undefined): Prisma.Sql | null {
  if (!assignee) return null;
  return assignee === "none" ? Prisma.sql`c.assigned_to IS NULL` : Prisma.sql`c.assigned_to = ${assignee}::uuid`;
}

const whereOf = (parts: Array<Prisma.Sql | null>): Prisma.Sql => {
  const present = parts.filter((p): p is Prisma.Sql => p !== null);
  return present.length > 0 ? Prisma.sql`WHERE ${Prisma.join(present, " AND ")}` : Prisma.empty;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";

interface VisibleRow {
  id: string;
  conversation_id: string;
  kind: SupportMessageKindValue;
  author_id: string | null;
  author_name: string | null;
  body: string;
  client_message_id: string | null;
  moderated: boolean;
  attachment_count: number;
  created_at: Date;
}

const messageFromRow = (r: VisibleRow): SupportMessageFacts => ({
  id: r.id,
  conversationId: r.conversation_id,
  kind: r.kind,
  authorId: r.author_id,
  authorName: r.author_name,
  body: r.body,
  clientMessageId: r.client_message_id,
  moderated: r.moderated,
  attachmentCount: r.attachment_count,
  createdAt: r.created_at,
});

type Tx = Prisma.TransactionClient;

/** Un evento del equipo, `offset` ms después de `now` para que queden en orden en el historial. */
async function insertEvent(tx: Tx, conversationId: string, actor: { id: string; fullName: string }, body: string, at: Date) {
  return tx.supportMessage.create({
    data: { conversationId, kind: "event", authorId: actor.id, authorName: actor.fullName, body, createdAt: at },
  });
}

async function lockConversation(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT 1 FROM shipments.support_conversations WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.supportConversation.findUniqueOrThrow({ where: { id } });
}

export function createSupportAdminRepository(db: PrismaClient): SupportAdminRepository {
  /** Fila completa (último mensaje visible y no leídos compartidos) de varias conversaciones, en dos queries. */
  async function rowsFor(ids: string[]): Promise<SupportAdminRow[]> {
    if (ids.length === 0) return [];
    const [conversations, lastRows, unreadRows] = await Promise.all([
      db.supportConversation.findMany({ where: { id: { in: ids } } }),
      db.$queryRaw<VisibleRow[]>`
        SELECT DISTINCT ON (m.conversation_id)
          m.id, m.conversation_id, m.kind::text AS kind, m.author_id, m.author_name, m.body, m.client_message_id,
          m.moderated, m.attachment_count, m.created_at
        FROM shipments.support_messages m
        WHERE m.conversation_id = ANY(${ids}::uuid[]) AND m.kind::text IN ('user', 'agent')
        ORDER BY m.conversation_id, m.created_at DESC, m.id DESC`,
      // No leídos del equipo (compartidos por conversación): lo que escribió el usuario después de que un agente la abrió.
      db.$queryRaw<Array<{ conversation_id: string; n: number }>>`
        SELECT m.conversation_id, COUNT(*)::int AS n
        FROM shipments.support_messages m
        JOIN shipments.support_conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = ANY(${ids}::uuid[]) AND m.kind::text = 'user'
          AND (c.last_agent_read_at IS NULL OR m.created_at > c.last_agent_read_at)
        GROUP BY m.conversation_id`,
    ]);
    const byId = new Map(conversations.map((c) => [c.id, c]));
    const lastBy = new Map(lastRows.map((r) => [r.conversation_id, messageFromRow(r)]));
    const unreadBy = new Map(unreadRows.map((r) => [r.conversation_id, r.n]));
    return ids.flatMap((id) => {
      const conversation = byId.get(id);
      return conversation ? [{ conversation, lastMessage: lastBy.get(id) ?? null, unread: unreadBy.get(id) ?? 0 }] : [];
    });
  }

  return {
    async list(query, limit) {
      const resolved = query.status === "resolved";
      const cursor = query.cursor ? decodeListCursor(query.cursor, !resolved) : null;
      const filters = [Prisma.sql`c.status::text = ${query.status}`, assigneeSql(query.assignee), searchSql(query.q, query.userIds)];

      // Abiertas y esperando: prioridad y después mayor espera. Resueltas: la última actividad primero (AC2).
      const rows = resolved
        ? await db.$queryRaw<Array<{ id: string; t: Date }>>`
            SELECT c.id, c.last_message_at AS t FROM shipments.support_conversations c
            ${whereOf([...filters, cursor ? Prisma.sql`(c.last_message_at, c.id) < (${new Date(cursor.t)}, ${cursor.i}::uuid)` : null])}
            ORDER BY c.last_message_at DESC, c.id DESC
            LIMIT ${limit + 1}`
        : await db.$queryRaw<Array<{ id: string; r: number; t: Date }>>`
            SELECT c.id, ${PRIORITY_RANK_SQL} AS r, c.last_user_message_at AS t FROM shipments.support_conversations c
            ${whereOf([
              ...filters,
              cursor
                ? Prisma.sql`(${PRIORITY_RANK_SQL}, c.last_user_message_at, c.id) > (${cursor.r ?? 0}, ${new Date(cursor.t)}, ${cursor.i}::uuid)`
                : null,
            ])}
            ORDER BY r ASC, c.last_user_message_at ASC, c.id ASC
            LIMIT ${limit + 1}`;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1] as { id: string; r?: number; t: Date } | undefined;
      const nextCursor =
        rows.length > limit && last
          ? encodeListCursor({ ...(last.r !== undefined ? { r: last.r } : {}), t: last.t.toISOString(), i: last.id })
          : null;
      return { items: await rowsFor(page.map((r) => r.id)), nextCursor };
    },

    async counts(query) {
      const search = searchSql(query.q, query.userIds);
      const [byStatusRows, ownerRows, unreadRows] = await Promise.all([
        db.$queryRaw<Array<{ status: SupportStatus; n: number }>>`
          SELECT c.status::text AS status, COUNT(*)::int AS n FROM shipments.support_conversations c
          ${whereOf([assigneeSql(query.assignee), search])}
          GROUP BY c.status`,
        db.$queryRaw<Array<{ all: number; mine: number; none: number }>>`
          SELECT COUNT(*)::int AS "all",
                 (COUNT(*) FILTER (WHERE c.assigned_to = ${query.viewerId}::uuid))::int AS mine,
                 (COUNT(*) FILTER (WHERE c.assigned_to IS NULL))::int AS "none"
          FROM shipments.support_conversations c
          ${whereOf([Prisma.sql`c.status::text = ${query.status}`, search])}`,
        db.$queryRaw<Array<{ n: number }>>`
          SELECT COUNT(*)::int AS n
          FROM shipments.support_messages m
          JOIN shipments.support_conversations c ON c.id = m.conversation_id
          WHERE m.kind::text = 'user' AND (c.last_agent_read_at IS NULL OR m.created_at > c.last_agent_read_at)`,
      ]);
      const byStatus: Record<SupportStatus, number> = { open: 0, awaiting_user: 0, resolved: 0 };
      for (const row of byStatusRows) byStatus[row.status] = row.n;
      const owner = ownerRows[0] ?? { all: 0, mine: 0, none: 0 };
      return { byStatus, byOwner: { all: owner.all, mine: owner.mine, none: owner.none }, unreadTotal: unreadRows[0]?.n ?? 0 };
    },

    async findRow(id) {
      return (await rowsFor([id]))[0] ?? null;
    },

    async listMessages(conversationId, limit, cursor) {
      const cursorFilter = cursor ? decodeCursor(cursor) : null;
      if (cursor && !cursorFilter) throw new InvalidSupportAdminCursorError();
      const rows = await db.supportMessage.findMany({
        where: {
          conversationId,
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
        take: limit + 1,
      });
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
    },

    async findStaffMessageByClientId(conversationId, clientMessageId) {
      return db.supportMessage.findFirst({ where: { conversationId, clientMessageId, kind: { in: ["agent", "note"] } } });
    },

    async agentLoads() {
      const rows = await db.supportConversation.groupBy({
        by: ["assignedTo"],
        where: { status: { not: "resolved" }, assignedTo: { not: null } },
        _count: { _all: true },
      });
      return rows.flatMap((r) => (r.assignedTo ? [{ agentId: r.assignedTo, activeCount: r._count._all }] : []));
    },

    async userConversations(userId, excludeId, limit) {
      const rows = await db.supportConversation.findMany({
        where: { userId, id: { not: excludeId } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows.map((c) => ({
        conversationId: c.id,
        code: formatSupportCode(c.codeNumber),
        topic: c.topic,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      }));
    },

    async appendAgentMessage(input) {
      try {
        return await db.$transaction(async (tx) => {
          const current = await lockConversation(tx, input.conversationId);
          const actor = { id: input.agentId, fullName: input.agentFullName };
          const events: SupportMessageFacts[] = [];
          let at = input.now.getTime();
          // Una respuesta (no una nota) reabre una resuelta y toma una sin asignar, con sus eventos antes del mensaje.
          if (!input.internal && current.status === "resolved") {
            events.push(await insertEvent(tx, input.conversationId, actor, supportEventText.reopened(actor.fullName), new Date(at++)));
          }
          if (!input.internal && current.assignedTo === null) {
            events.push(await insertEvent(tx, input.conversationId, actor, supportEventText.took(actor.fullName), new Date(at++)));
          }
          const messageAt = new Date(at);
          const message = await tx.supportMessage.create({
            data: {
              conversationId: input.conversationId,
              kind: input.internal ? "note" : "agent",
              authorId: input.agentId,
              // El usuario ve el nombre de pila del agente; el panel resuelve el completo por `authorId`.
              authorName: input.agentFirstName,
              body: input.body,
              clientMessageId: input.clientMessageId,
              attachmentCount: input.attachmentIds.length,
              createdAt: messageAt,
            },
          });
          await claimSupportAttachments(tx, {
            claim: { ids: input.attachmentIds, uploaderKind: "staff" },
            uploaderId: input.agentId,
            conversationId: input.conversationId,
            messageId: message.id,
          });
          const conversation = input.internal
            ? current
            : await tx.supportConversation.update({
                where: { id: input.conversationId },
                data: {
                  status: "awaiting_user",
                  resolvedAt: null,
                  assignedTo: current.assignedTo ?? input.agentId,
                  lastMessageAt: messageAt,
                },
              });
          return { message, events, conversation, created: true, statusChanged: conversation.status !== current.status };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Reenvío del mismo `clientMessageId` (idempotencia): se devuelve lo ya guardado, sin efectos nuevos.
        const existing = await db.supportMessage.findFirst({
          where: { conversationId: input.conversationId, clientMessageId: input.clientMessageId },
        });
        const conversation = await db.supportConversation.findUnique({ where: { id: input.conversationId } });
        if (!existing || !conversation) throw error;
        return { message: existing, events: [], conversation, created: false, statusChanged: false };
      }
    },

    async applyPatch(input) {
      return db.$transaction(async (tx) => {
        const current = await lockConversation(tx, input.conversationId);
        const actor = { id: input.actorId, fullName: input.actorFullName };
        const texts: string[] = [];
        const data: Prisma.SupportConversationUpdateInput = {};

        if (input.assignedTo !== undefined && input.assignedTo !== current.assignedTo) {
          data.assignedTo = input.assignedTo;
          texts.push(
            input.assignedTo === null
              ? supportEventText.unassigned(actor.fullName)
              : input.assignedTo === actor.id
                ? supportEventText.took(actor.fullName)
                : supportEventText.assigned(actor.fullName, input.assigneeFullName ?? "otro agente")
          );
        }
        if (input.priority && input.priority !== current.priority) {
          data.priority = input.priority;
          texts.push(supportEventText.priority(input.priority));
        }
        if (input.topic && input.topic !== current.topic) {
          data.topic = input.topic;
          texts.push(supportEventText.topic(input.topic));
        }
        // Las etiquetas no generan evento (AC6).
        if (input.tags && [...input.tags].sort().join("|") !== [...current.tags].sort().join("|")) {
          data.tags = input.tags;
        }
        if (input.shipmentId !== undefined && input.shipmentId !== current.shipmentId) {
          data.shipment = input.shipmentId === null ? { disconnect: true } : { connect: { id: input.shipmentId } };
          texts.push(input.shipmentId === null ? supportEventText.unlinked() : supportEventText.linked(input.shipmentId));
        }

        if (Object.keys(data).length === 0) return { conversation: current, events: [], changed: false };
        const events: SupportMessageFacts[] = [];
        for (const [i, text] of texts.entries()) {
          events.push(await insertEvent(tx, input.conversationId, actor, text, new Date(input.now.getTime() + i)));
        }
        const conversation = await tx.supportConversation.update({ where: { id: input.conversationId }, data });
        return { conversation, events, changed: true };
      });
    },

    async setResolved(input) {
      return db.$transaction(async (tx) => {
        const current = await lockConversation(tx, input.conversationId);
        const isResolved = current.status === "resolved";
        // Resolver una resuelta o reabrir una que no lo está no hace nada (idempotente).
        if (isResolved === input.resolved) return { conversation: current, events: [], changed: false };
        const actor = { id: input.actorId, fullName: input.actorFullName };
        const text = input.resolved ? supportEventText.resolved(actor.fullName) : supportEventText.reopened(actor.fullName);
        const event = await insertEvent(tx, input.conversationId, actor, text, input.now);
        const conversation = await tx.supportConversation.update({
          where: { id: input.conversationId },
          data: input.resolved ? { status: "resolved", resolvedAt: input.now } : { status: "open", resolvedAt: null },
        });
        return { conversation, events: [event], changed: true };
      });
    },
  };
}
