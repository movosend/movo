import { PrismaClient, Prisma } from "../generated/prisma/client";
import { SupportStatus, SupportTopic, SUPPORT_REOPENED_MESSAGE } from "@movo/shared";
import {
  SupportConversationFacts,
  SupportMessageFacts,
  SupportMessageKindValue,
  statusAfterUserMessage,
  USER_VISIBLE_MESSAGE_KINDS,
} from "../domain/support-rules";
import { decodeCursor, encodeCursor } from "../utils/cursor";

export interface SupportConversationRecord extends SupportConversationFacts {
  priority: "urgent" | "high" | "normal" | "low";
  assignedTo: string | null;
  tags: string[];
  createdAt: Date;
  lastUserMessageAt: Date;
  resolvedAt: Date | null;
}

export type SupportMessageRecord = SupportMessageFacts;

export interface NewSupportConversation {
  userId: string;
  topic: SupportTopic;
  shipmentId: string | null;
  /** Ya moderado. */
  body: string;
  moderated: boolean;
  clientMessageId: string;
  now: Date;
}

export interface NewUserSupportMessage {
  conversationId: string;
  userId: string;
  body: string;
  moderated: boolean;
  clientMessageId: string;
  now: Date;
}

/** Mensaje de un agente, una nota interna o un evento `system` (lo escribe el lado del agente, MOVO-322). */
export interface NewStaffSupportMessage {
  conversationId: string;
  kind: Exclude<SupportMessageKindValue, "user">;
  authorId: string | null;
  authorName: string | null;
  body: string;
  clientMessageId: string | null;
  now: Date;
  /** Estado al que pasa la conversación con este mensaje (ej. `awaiting_user` cuando responde un agente). */
  nextStatus?: SupportStatus;
}

export interface SupportConversationRow {
  conversation: SupportConversationRecord;
  lastMessage: SupportMessageRecord | null;
  unreadCount: number;
}

export interface SupportRepository {
  /**
   * Crea la conversación y su primer mensaje en una transacción. Idempotente por `(userId, clientMessageId)`: el
   * índice único parcial lo garantiza aun con dos pedidos simultáneos; el reintento devuelve lo ya creado.
   */
  createWithFirstMessage(
    input: NewSupportConversation
  ): Promise<{ conversation: SupportConversationRecord; message: SupportMessageRecord; created: boolean }>;
  /** El mensaje del usuario con ese `clientMessageId` (en cualquier conversación), o `null`. */
  findUserMessageByClientId(userId: string, clientMessageId: string): Promise<SupportMessageRecord | null>;
  findById(id: string): Promise<SupportConversationRecord | null>;
  /** Solo si la conversación es de `userId`: ajena e inexistente son lo mismo (404, no se filtra existencia). */
  findOwned(id: string, userId: string): Promise<SupportConversationRecord | null>;
  /**
   * Mensaje del usuario sobre una conversación existente. Aplica la transición de estado (reabre una `resolved`,
   * pasa una `awaiting_user` a `open`) y, al reabrir, deja el mensaje `system`. Idempotente por `clientMessageId`.
   */
  appendUserMessage(input: NewUserSupportMessage): Promise<{
    message: SupportMessageRecord;
    created: boolean;
    conversation: SupportConversationRecord;
    systemMessage: SupportMessageRecord | null;
    statusChanged: boolean;
  }>;
  appendStaffMessage(input: NewStaffSupportMessage): Promise<{ message: SupportMessageRecord; conversation: SupportConversationRecord }>;
  /** Del más reciente al más antiguo, solo lo que ve el usuario (sin notas), con cursor keyset. */
  listUserVisibleMessages(
    conversationId: string,
    limit: number,
    cursor?: string
  ): Promise<{ items: SupportMessageRecord[]; nextCursor: string | null }>;
  /** Conversaciones de `userId`, la de actividad más reciente primero. */
  listByUser(userId: string, limit: number): Promise<SupportConversationRow[]>;
  /** Lista/encabezado de una sola conversación (último mensaje visible y no leídos). */
  rowFor(conversation: SupportConversationRecord, userId: string): Promise<SupportConversationRow>;
  unreadCount(conversationId: string, userId: string): Promise<number>;
  markDelivered(conversationId: string, userId: string, at: Date): Promise<void>;
  markRead(conversationId: string, userId: string, at: Date): Promise<void>;
  /** Un agente abrió la conversación: avanza (nunca retrocede) los tildes "leído" del usuario. */
  markAgentRead(conversationId: string, at: Date): Promise<void>;
}

export class InvalidSupportCursorError extends Error {
  constructor() {
    super("Cursor de paginación inválido");
    this.name = "InvalidSupportCursorError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

interface VisibleRow {
  id: string;
  conversation_id: string;
  kind: SupportMessageKindValue;
  author_id: string | null;
  author_name: string | null;
  body: string;
  client_message_id: string | null;
  moderated: boolean;
  created_at: Date;
}

function messageFromRow(r: VisibleRow): SupportMessageRecord {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    kind: r.kind,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    clientMessageId: r.client_message_id,
    moderated: r.moderated,
    createdAt: r.created_at,
  };
}

export function createSupportRepository(db: PrismaClient): SupportRepository {
  const toConversation = (c: Prisma.SupportConversationGetPayload<object>): SupportConversationRecord => c;

  async function lastVisibleMessage(conversationId: string): Promise<SupportMessageRecord | null> {
    // Solo lo que el usuario escribió o un agente le contestó: ni notas ni eventos de sistema.
    return db.supportMessage.findFirst({
      where: { conversationId, kind: { in: ["user", "agent"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async function unreadFor(conversationId: string, userId: string): Promise<number> {
    const state = await db.supportParticipantState.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadAt: true },
    });
    // Solo cuentan las respuestas de un agente: lo que escribió el usuario, una nota o un evento no son "no leídos".
    return db.supportMessage.count({
      where: {
        conversationId,
        kind: "agent",
        ...(state?.lastReadAt ? { createdAt: { gt: state.lastReadAt } } : {}),
      },
    });
  }

  async function findUserMessageByClientId(userId: string, clientMessageId: string): Promise<SupportMessageRecord | null> {
    return db.supportMessage.findFirst({ where: { kind: "user", authorId: userId, clientMessageId } });
  }

  async function findById(id: string): Promise<SupportConversationRecord | null> {
    const found = await db.supportConversation.findUnique({ where: { id } });
    return found ? toConversation(found) : null;
  }

  return {
    async createWithFirstMessage(input) {
      try {
        return await db.$transaction(async (tx) => {
          // `createdAt` lo fija la app (precisión de ms): el cursor viaja como ISO en ms (ver `utils/cursor.ts`).
          const conversation = await tx.supportConversation.create({
            data: {
              userId: input.userId,
              topic: input.topic,
              shipmentId: input.shipmentId,
              createdAt: input.now,
              lastMessageAt: input.now,
              lastUserMessageAt: input.now,
            },
          });
          const message = await tx.supportMessage.create({
            data: {
              conversationId: conversation.id,
              kind: "user",
              authorId: input.userId,
              body: input.body,
              moderated: input.moderated,
              clientMessageId: input.clientMessageId,
              createdAt: input.now,
            },
          });
          return { conversation: toConversation(conversation), message, created: true };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await findUserMessageByClientId(input.userId, input.clientMessageId);
        const conversation = existing ? await findById(existing.conversationId) : null;
        if (!existing || !conversation) throw error;
        return { conversation, message: existing, created: false };
      }
    },

    findUserMessageByClientId,

    findById,

    async findOwned(id, userId) {
      const found = await db.supportConversation.findFirst({ where: { id, userId } });
      return found ? toConversation(found) : null;
    },

    async appendUserMessage(input) {
      try {
        return await db.$transaction(async (tx) => {
          // Bloqueo de fila: dos mensajes simultáneos sobre una `resolved` no reabren dos veces.
          const locked = await tx.$queryRaw<Array<{ status: SupportStatus }>>`
            SELECT status::text AS status FROM shipments.support_conversations WHERE id = ${input.conversationId}::uuid FOR UPDATE`;
          const current = locked[0]?.status;
          if (!current) throw new Error("La conversación no existe");
          const transition = statusAfterUserMessage(current);

          const message = await tx.supportMessage.create({
            data: {
              conversationId: input.conversationId,
              kind: "user",
              authorId: input.userId,
              body: input.body,
              moderated: input.moderated,
              clientMessageId: input.clientMessageId,
              createdAt: input.now,
            },
          });
          let systemMessage: SupportMessageRecord | null = null;
          if (transition.reopened) {
            // 1 ms después del mensaje, para que el evento quede a continuación en el historial.
            systemMessage = await tx.supportMessage.create({
              data: {
                conversationId: input.conversationId,
                kind: "system",
                body: SUPPORT_REOPENED_MESSAGE,
                createdAt: new Date(input.now.getTime() + 1),
              },
            });
          }
          const conversation = await tx.supportConversation.update({
            where: { id: input.conversationId },
            data: {
              status: transition.status,
              ...(transition.reopened ? { resolvedAt: null } : {}),
              lastMessageAt: systemMessage ? systemMessage.createdAt : input.now,
              lastUserMessageAt: input.now,
            },
          });
          return {
            message,
            created: true,
            conversation: toConversation(conversation),
            systemMessage,
            statusChanged: transition.status !== current,
          };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await findUserMessageByClientId(input.userId, input.clientMessageId);
        const conversation = existing ? await findById(existing.conversationId) : null;
        if (!existing || !conversation) throw error;
        return { message: existing, created: false, conversation, systemMessage: null, statusChanged: false };
      }
    },

    async appendStaffMessage(input) {
      return db.$transaction(async (tx) => {
        // Mismo bloqueo de fila que `appendUserMessage`: si el usuario escribe sobre una `resolved` justo cuando
        // un agente la resuelve, uno espera al otro y el `nextStatus` no pisa la reapertura.
        await tx.$queryRaw`SELECT 1 FROM shipments.support_conversations WHERE id = ${input.conversationId}::uuid FOR UPDATE`;
        const message = await tx.supportMessage.create({
          data: {
            conversationId: input.conversationId,
            kind: input.kind,
            authorId: input.authorId,
            authorName: input.authorName,
            body: input.body,
            clientMessageId: input.clientMessageId,
            createdAt: input.now,
          },
        });
        const conversation = await tx.supportConversation.update({
          where: { id: input.conversationId },
          data: {
            // Una nota interna no mueve `lastMessageAt`: el usuario lo ve como `lastActivityAt` y ordena su lista.
            ...(input.kind !== "note" ? { lastMessageAt: input.now } : {}),
            ...(input.nextStatus ? { status: input.nextStatus, resolvedAt: input.nextStatus === "resolved" ? input.now : null } : {}),
          },
        });
        return { message, conversation: toConversation(conversation) };
      });
    },

    async listUserVisibleMessages(conversationId, limit, cursor) {
      const cursorFilter = cursor ? decodeCursor(cursor) : null;
      if (cursor && !cursorFilter) throw new InvalidSupportCursorError();
      const rows = await db.supportMessage.findMany({
        where: {
          conversationId,
          // Las notas internas nunca salen de acá: lista blanca de `kind` (ver `USER_VISIBLE_MESSAGE_KINDS`).
          kind: { in: [...USER_VISIBLE_MESSAGE_KINDS] },
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

    async listByUser(userId, limit) {
      const conversations = await db.supportConversation.findMany({
        where: { userId },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      if (conversations.length === 0) return [];
      const ids = conversations.map((c) => c.id);
      // Último mensaje VISIBLE de cada conversación (usuario o agente: ni notas ni eventos) y no leídos, en una
      // query cada uno en vez de dos por fila.
      const lastRows = await db.$queryRaw<VisibleRow[]>`
        SELECT DISTINCT ON (m.conversation_id)
          m.id, m.conversation_id, m.kind::text AS kind, m.author_id, m.author_name, m.body, m.client_message_id, m.moderated, m.created_at
        FROM shipments.support_messages m
        WHERE m.conversation_id = ANY(${ids}::uuid[]) AND m.kind::text IN ('user', 'agent')
        ORDER BY m.conversation_id, m.created_at DESC, m.id DESC`;
      const unreadRows = await db.$queryRaw<Array<{ conversation_id: string; n: number }>>`
        SELECT m.conversation_id, COUNT(*)::int AS n
        FROM shipments.support_messages m
        LEFT JOIN shipments.support_participant_states s
          ON s.conversation_id = m.conversation_id AND s.user_id = ${userId}::uuid
        WHERE m.conversation_id = ANY(${ids}::uuid[])
          AND m.kind::text = 'agent'
          AND (s.last_read_at IS NULL OR m.created_at > s.last_read_at)
        GROUP BY m.conversation_id`;
      const lastBy = new Map(lastRows.map((r) => [r.conversation_id, messageFromRow(r)]));
      const unreadBy = new Map(unreadRows.map((r) => [r.conversation_id, r.n]));
      return conversations.map((c) => ({
        conversation: toConversation(c),
        lastMessage: lastBy.get(c.id) ?? null,
        unreadCount: unreadBy.get(c.id) ?? 0,
      }));
    },

    async rowFor(conversation, userId) {
      return {
        conversation,
        lastMessage: await lastVisibleMessage(conversation.id),
        unreadCount: await unreadFor(conversation.id, userId),
      };
    },

    unreadCount: unreadFor,

    async markDelivered(conversationId, userId, at) {
      // GREATEST: los instantes solo avanzan aunque lleguen dos marcas fuera de orden.
      await db.$executeRaw`
        INSERT INTO shipments.support_participant_states (conversation_id, user_id, last_delivered_at)
        VALUES (${conversationId}::uuid, ${userId}::uuid, ${at})
        ON CONFLICT (conversation_id, user_id) DO UPDATE
          SET last_delivered_at = GREATEST(shipments.support_participant_states.last_delivered_at, EXCLUDED.last_delivered_at)`;
    },

    async markRead(conversationId, userId, at) {
      await db.$executeRaw`
        INSERT INTO shipments.support_participant_states (conversation_id, user_id, last_delivered_at, last_read_at)
        VALUES (${conversationId}::uuid, ${userId}::uuid, ${at}, ${at})
        ON CONFLICT (conversation_id, user_id) DO UPDATE SET
          last_delivered_at = GREATEST(shipments.support_participant_states.last_delivered_at, EXCLUDED.last_delivered_at),
          last_read_at = GREATEST(shipments.support_participant_states.last_read_at, EXCLUDED.last_read_at)`;
    },

    async markAgentRead(conversationId, at) {
      await db.$executeRaw`
        UPDATE shipments.support_conversations
        SET last_agent_read_at = GREATEST(last_agent_read_at, ${at})
        WHERE id = ${conversationId}::uuid`;
    },
  };
}
