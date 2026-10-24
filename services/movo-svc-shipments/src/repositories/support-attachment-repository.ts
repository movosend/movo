import { PrismaClient, Prisma } from "../generated/prisma/client";

/** MOVO-321: quién subió el adjunto. Un adjunto del usuario solo lo usa el usuario y uno del agente solo un agente. */
export type SupportAttachmentUploaderKind = "user" | "staff";

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

/**
 * Algún adjunto no se pudo asociar (ajeno, ya usado, de otra conversación o borrado por el sweep). Se tira DENTRO
 * de la transacción del mensaje para deshacerla entera; el servicio la traduce a 422.
 */
export class SupportAttachmentClaimError extends Error {
  constructor() {
    super("Algún adjunto no se puede asociar a este mensaje");
    this.name = "SupportAttachmentClaimError";
  }
}

/**
 * Asocia los adjuntos al mensaje, en la transacción que lo crea. El `WHERE message_id IS NULL` hace el uso único
 * atómico: dos mensajes simultáneos con el mismo adjunto no pueden ganar los dos (el segundo espera el bloqueo de
 * fila y ya no matchea), y uno que el sweep borró tampoco. `position` es el orden de `ids`.
 */
export async function claimSupportAttachments(
  tx: Prisma.TransactionClient,
  input: { claim: SupportAttachmentClaim; uploaderId: string; conversationId: string; messageId: string }
): Promise<void> {
  const { ids, uploaderKind } = input.claim;
  if (ids.length === 0) return;
  const updated = await tx.$executeRaw`
    UPDATE shipments.support_attachments a
    SET message_id = ${input.messageId}::uuid, conversation_id = ${input.conversationId}::uuid, position = t.ord::int
    FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS t(id, ord)
    WHERE a.id = t.id
      AND a.uploader_id = ${input.uploaderId}::uuid
      AND a.uploader_kind::text = ${uploaderKind}
      AND a.message_id IS NULL
      AND (a.conversation_id IS NULL OR a.conversation_id = ${input.conversationId}::uuid)`;
  if (updated !== ids.length) throw new SupportAttachmentClaimError();
}

export interface SupportAttachmentRepository {
  create(input: NewSupportAttachment): Promise<SupportAttachmentRecord>;
  findByIds(ids: string[]): Promise<SupportAttachmentRecord[]>;
  /** Los adjuntos de esos mensajes, en el orden en que se mandaron. */
  listForMessages(messageIds: string[]): Promise<SupportAttachmentRecord[]>;
  /**
   * Borra (y devuelve las keys de) hasta `limit` adjuntos nunca asociados creados antes de `cutoff`. La fila se borra
   * ANTES que el objeto: desde ese momento ningún mensaje puede asociarlo, así que borrar el objeto ya no rompe nada.
   */
  deleteOrphans(cutoff: Date, limit: number): Promise<string[]>;
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

    async findByIds(ids) {
      if (ids.length === 0) return [];
      return db.supportAttachment.findMany({ where: { id: { in: ids } } });
    },

    async listForMessages(messageIds) {
      if (messageIds.length === 0) return [];
      return db.supportAttachment.findMany({
        where: { messageId: { in: messageIds } },
        orderBy: [{ messageId: "asc" }, { position: "asc" }],
      });
    },

    async deleteOrphans(cutoff, limit) {
      const rows = await db.$queryRaw<Array<{ s3_key: string }>>`
        DELETE FROM shipments.support_attachments
        WHERE id IN (
          SELECT id FROM shipments.support_attachments
          WHERE message_id IS NULL AND created_at < ${cutoff}
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING s3_key`;
      return rows.map((r) => r.s3_key);
    },
  };
}
