import { SUPPORT_ATTACHMENT_MAX_PER_MESSAGE } from "@movo/shared";
import { PrismaClient, Prisma, SupportAttachmentUploader } from "../generated/prisma/client";

/** MOVO-321: quién subió el adjunto. Un adjunto del usuario solo lo usa el usuario y uno del agente solo un agente. */
export type SupportAttachmentUploaderKind = SupportAttachmentUploader;

export interface SupportAttachmentRecord {
  id: string;
  uploaderId: string;
  uploaderKind: SupportAttachmentUploaderKind;
  conversationId: string | null;
  messageId: string | null;
  position: number | null;
  s3Key: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  deletingAt: Date | null;
}

export interface NewSupportAttachment {
  id: string;
  uploaderId: string;
  uploaderKind: SupportAttachmentUploaderKind;
  conversationId: string | null;
  s3Key: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  now: Date;
}

/** Adjuntos que se asocian a un mensaje al crearlo. El que los asocia es el autor del mensaje. */
export interface SupportAttachmentClaim {
  ids: string[];
  uploaderKind: SupportAttachmentUploaderKind;
}

/** Quién quiere usar los adjuntos y en qué conversación (`null`: la primera consulta, que todavía no existe). */
export interface SupportAttachmentUse {
  uploaderId: string;
  uploaderKind: SupportAttachmentUploaderKind;
  conversationId: string | null;
}

/**
 * Algún adjunto no se pudo asociar (ajeno, ya usado, de otra conversación, en borrado por el sweep, repetido o de
 * más). Se tira DENTRO de la transacción del mensaje para deshacerla entera; el servicio la traduce a 422.
 */
export class SupportAttachmentClaimError extends Error {
  constructor() {
    super("Algún adjunto no se puede asociar a este mensaje");
    this.name = "SupportAttachmentClaimError";
  }
}

/**
 * ÚNICA definición de "este adjunto se puede usar acá" (review de la PR #299): la usan la consulta previa al mensaje
 * (`findUsable`) y el claim dentro de la transacción, así no pueden quedar distintas. Con `conversationId` nulo solo
 * valen los que tampoco tienen conversación (`support/pending/…`).
 */
function usablePredicate(use: SupportAttachmentUse): Prisma.Sql {
  const conversation = use.conversationId
    ? Prisma.sql`(a.conversation_id IS NULL OR a.conversation_id = ${use.conversationId}::uuid)`
    : Prisma.sql`a.conversation_id IS NULL`;
  return Prisma.sql`a.uploader_id = ${use.uploaderId}::uuid
      AND a.uploader_kind::text = ${use.uploaderKind}
      AND a.message_id IS NULL
      AND a.deleting_at IS NULL
      AND ${conversation}`;
}

/** Cantidad y repetidos: también en el claim, así ningún camino (ni el del agente, MOVO-322) se los saltea. */
function assertClaimShape(ids: string[]): void {
  if (ids.length > SUPPORT_ATTACHMENT_MAX_PER_MESSAGE || new Set(ids).size !== ids.length) {
    throw new SupportAttachmentClaimError();
  }
}

/**
 * Asocia los adjuntos al mensaje, en la transacción que lo crea. El `WHERE message_id IS NULL` hace el uso único
 * atómico: dos mensajes simultáneos con el mismo adjunto no pueden ganar los dos (el segundo espera el bloqueo de
 * fila y ya no matchea), y uno que el sweep marcó para borrar tampoco. `position` es el orden de `ids`.
 */
export async function claimSupportAttachments(
  tx: Prisma.TransactionClient,
  input: { claim: SupportAttachmentClaim; uploaderId: string; conversationId: string; messageId: string }
): Promise<void> {
  const { ids, uploaderKind } = input.claim;
  if (ids.length === 0) return;
  assertClaimShape(ids);
  const predicate = usablePredicate({ uploaderId: input.uploaderId, uploaderKind, conversationId: input.conversationId });
  const updated = await tx.$executeRaw`
    UPDATE shipments.support_attachments a
    SET message_id = ${input.messageId}::uuid, conversation_id = ${input.conversationId}::uuid, position = t.ord::int
    FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS t(id, ord)
    WHERE a.id = t.id AND ${predicate}`;
  if (updated !== ids.length) throw new SupportAttachmentClaimError();
}

export interface SupportAttachmentRepository {
  create(input: NewSupportAttachment): Promise<SupportAttachmentRecord>;
  /** De `ids`, los que `use` puede asociar ahora (misma regla que el claim). */
  findUsable(ids: string[], use: SupportAttachmentUse): Promise<SupportAttachmentRecord[]>;
  /** Adjuntos pedidos y todavía sin usar de quien sube (para el tope de pendientes). */
  countPending(uploaderId: string): Promise<number>;
  /** Los adjuntos de esos mensajes, en el orden en que se mandaron. */
  listForMessages(messageIds: string[]): Promise<SupportAttachmentRecord[]>;
  /**
   * Paso 1 del sweep: marca (y devuelve) hasta `limit` adjuntos nunca asociados creados antes de `cutoff`, más los que
   * una corrida anterior marcó y no pudo terminar de borrar. Desde la marca ningún mensaje puede asociarlos, así que
   * borrar el objeto ya no rompe nada; la fila queda hasta que S3 confirme.
   */
  markOrphansForDeletion(cutoff: Date, now: Date, limit: number): Promise<Array<{ id: string; s3Key: string }>>;
  /** Paso 2 del sweep: borra la fila de un adjunto marcado cuyo objeto ya se borró. */
  deleteMarked(id: string): Promise<void>;
}

export function createSupportAttachmentRepository(db: PrismaClient): SupportAttachmentRepository {
  return {
    async create(input) {
      return db.supportAttachment.create({
        data: {
          id: input.id,
          uploaderId: input.uploaderId,
          uploaderKind: input.uploaderKind,
          conversationId: input.conversationId,
          s3Key: input.s3Key,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          width: input.width,
          height: input.height,
          createdAt: input.now,
        },
      });
    },

    async findUsable(ids, use) {
      if (ids.length === 0) return [];
      const rows = await db.$queryRaw<Array<{ id: string }>>`
        SELECT a.id FROM shipments.support_attachments a
        WHERE a.id = ANY(${ids}::uuid[]) AND ${usablePredicate(use)}`;
      if (rows.length === 0) return [];
      return db.supportAttachment.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    },

    async countPending(uploaderId) {
      return db.supportAttachment.count({ where: { uploaderId, messageId: null, deletingAt: null } });
    },

    async listForMessages(messageIds) {
      if (messageIds.length === 0) return [];
      return db.supportAttachment.findMany({
        where: { messageId: { in: messageIds } },
        orderBy: [{ messageId: "asc" }, { position: "asc" }],
      });
    },

    async markOrphansForDeletion(cutoff, now, limit) {
      return db.$queryRaw<Array<{ id: string; s3Key: string }>>`
        UPDATE shipments.support_attachments
        SET deleting_at = COALESCE(deleting_at, ${now})
        WHERE id IN (
          SELECT id FROM shipments.support_attachments
          WHERE message_id IS NULL AND (deleting_at IS NOT NULL OR created_at < ${cutoff})
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, s3_key AS "s3Key"`;
    },

    async deleteMarked(id) {
      await db.supportAttachment.deleteMany({ where: { id, messageId: null, deletingAt: { not: null } } });
    },
  };
}
