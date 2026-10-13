import { PrismaClient } from "../generated/prisma/client";

export interface ChatMessageRecord {
  id: string;
  shipmentId: string;
  authorId: string;
  body: string;
  clientMessageId: string;
  createdAt: Date;
}

export interface NewChatMessage {
  shipmentId: string;
  authorId: string;
  body: string;
  clientMessageId: string;
}

export interface ChatRepository {
  /**
   * Guarda un mensaje. Idempotente por `(shipmentId, authorId, clientMessageId)`: reenviar el mismo
   * mensaje devuelve el ya guardado con `created: false` (la garantía vive en el índice único, no
   * en un chequeo previo).
   */
  create(input: NewChatMessage): Promise<{ message: ChatMessageRecord; created: boolean }>;
  /** Del más reciente al más antiguo, con cursor keyset sobre `(createdAt, id)`. */
  listPage(
    shipmentId: string,
    limit: number,
    cursor?: string
  ): Promise<{ items: ChatMessageRecord[]; nextCursor: string | null }>;
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

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [createdAtRaw, id] = Buffer.from(cursor, "base64").toString("utf8").split("|");
  const createdAt = new Date(createdAtRaw ?? "");
  if (!id || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

export class InvalidChatCursorError extends Error {
  constructor() {
    super("Cursor de paginación inválido");
    this.name = "InvalidChatCursorError";
  }
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

    async listPage(shipmentId, limit, cursor) {
      const cursorFilter = cursor ? decodeCursor(cursor) : null;
      if (cursor && !cursorFilter) throw new InvalidChatCursorError();
      const rows = await db.chatMessage.findMany({
        where: {
          shipmentId,
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
  };
}
