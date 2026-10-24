import { randomUUID } from "node:crypto";
import {
  ApiError,
  SupportAttachment,
  SupportAttachmentCreateResult,
  SupportAttachmentType,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MAX_PENDING,
  SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
  SUPPORT_ATTACHMENT_TYPES,
} from "@movo/shared";
import { StorageProvider } from "../../adapters/storage-provider";
import {
  SupportAttachmentRecord,
  SupportAttachmentRepository,
  SupportAttachmentUploaderKind,
} from "../../repositories/support-attachment-repository";

/** Vida de la URL firmada de lectura (AC5): se genera al leer, nunca se persiste. */
export const SUPPORT_ATTACHMENT_URL_TTL_SECONDS = 15 * 60;

const EXTENSION_BY_TYPE: Record<SupportAttachmentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function attachmentInvalid(message: string): ApiError {
  return new ApiError(422, "SUPPORT_ATTACHMENT_INVALID", message);
}

function isAttachmentType(value: string): value is SupportAttachmentType {
  return (SUPPORT_ATTACHMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Prefijo privado del bucket (AC2), nunca el público de fotos de perfil (ADR-016). Sin conversación (la primera
 * consulta del usuario, que todavía no existe) va a `support/pending/<userId>/`: al asociarlo el objeto NO se mueve,
 * la fila guarda la key. Moverlo pediría `CopyObject` además de `DeleteObject` y no cambia la privacidad.
 */
export function supportAttachmentKey(input: {
  attachmentId: string;
  contentType: SupportAttachmentType;
  conversationId: string | null;
  uploaderId: string;
}): string {
  const folder = input.conversationId ?? `pending/${input.uploaderId}`;
  return `support/${folder}/${input.attachmentId}.${EXTENSION_BY_TYPE[input.contentType]}`;
}

export interface SupportAttachmentsServiceDeps {
  repository: SupportAttachmentRepository;
  storage: StorageProvider;
  now?: () => Date;
}

/**
 * MOVO-321: adjuntos de imágenes de soporte (ADR-007, mismo flujo presign → PUT → HEAD que las fotos del envío). Lo
 * usan el lado del usuario (`/support`) y el del agente (MOVO-322). Ninguna función de acá decide el acceso a la
 * conversación: quien llama ya la autorizó.
 */
export function createSupportAttachmentsService(deps: SupportAttachmentsServiceDeps) {
  const now = deps.now ?? (() => new Date());

  function toView(record: SupportAttachmentRecord, url: string): SupportAttachment {
    return {
      id: record.id,
      contentType: record.contentType as SupportAttachmentType,
      ...(record.width !== null ? { width: record.width } : {}),
      ...(record.height !== null ? { height: record.height } : {}),
      url,
    };
  }

  return {
    /** AC1: valida tipo y tamaño (422 si no) y firma el `PUT`, con el tipo y el tamaño dentro de la firma. */
    async create(input: {
      uploaderId: string;
      uploaderKind: SupportAttachmentUploaderKind;
      conversationId: string | null;
      contentType: string;
      sizeBytes: number;
      width?: number;
      height?: number;
    }): Promise<SupportAttachmentCreateResult> {
      if (!isAttachmentType(input.contentType)) {
        throw attachmentInvalid("Solo se pueden adjuntar imágenes JPEG, PNG o WebP.");
      }
      if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
        throw attachmentInvalid("La imagen tiene que pesar como máximo 5 MB.");
      }
      // Tope de pedidas sin usar (review de la PR #299): sin esto un script llena la tabla y el bucket hasta que pase
      // el sweep. Se liberan al usarlas en un mensaje o cuando el sweep borra las vencidas.
      if ((await deps.repository.countPending(input.uploaderId)) >= SUPPORT_ATTACHMENT_MAX_PENDING) {
        throw new ApiError(
          429,
          "SUPPORT_ATTACHMENT_PENDING_LIMIT",
          "Tenés muchas imágenes subidas sin enviar. Mandalas o esperá un rato antes de subir más."
        );
      }
      const attachmentId = randomUUID();
      const s3Key = supportAttachmentKey({
        attachmentId,
        contentType: input.contentType,
        conversationId: input.conversationId,
        uploaderId: input.uploaderId,
      });
      const createdAt = now();
      // Primero la URL: si el storage falla no queda una fila sin objeto posible.
      const { uploadUrl, expiresIn } = await deps.storage.createUploadUrl({
        key: s3Key,
        contentType: input.contentType,
        contentLength: input.sizeBytes,
      });
      await deps.repository.create({
        id: attachmentId,
        uploaderId: input.uploaderId,
        uploaderKind: input.uploaderKind,
        conversationId: input.conversationId,
        s3Key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        width: input.width ?? null,
        height: input.height ?? null,
        now: createdAt,
      });
      return { attachmentId, uploadUrl, expiresAt: new Date(createdAt.getTime() + expiresIn * 1000).toISOString() };
    },

    /**
     * AC3/AC4, antes de abrir la transacción del mensaje: cantidad, dueño, uso único, conversación y que el objeto
     * esté en el bucket con el tipo y tamaño declarados (HEAD real). La regla de "se puede usar" es la misma que aplica
     * el claim (`findUsable`, un solo predicado SQL), que la vuelve a garantizar atómica al asociarlos; esto es para
     * responder bien y no tener S3 dentro de la transacción. El lado del agente (MOVO-322) tiene que pasar por acá:
     * el claim repite la cantidad y los repetidos, pero no puede hacer el HEAD.
     */
    async assertUsable(input: {
      ids: string[];
      uploaderId: string;
      uploaderKind: SupportAttachmentUploaderKind;
      conversationId: string | null;
    }): Promise<void> {
      if (input.ids.length === 0) return;
      if (input.ids.length > SUPPORT_ATTACHMENT_MAX_PER_MESSAGE) {
        throw attachmentInvalid(`Un mensaje puede llevar hasta ${SUPPORT_ATTACHMENT_MAX_PER_MESSAGE} imágenes.`);
      }
      if (new Set(input.ids).size !== input.ids.length) throw attachmentInvalid("Una imagen está repetida.");

      const records = await deps.repository.findUsable(input.ids, {
        uploaderId: input.uploaderId,
        uploaderKind: input.uploaderKind,
        conversationId: input.conversationId,
      });
      // Ajeno, inexistente, ya usado, en borrado o de otra consulta: la misma respuesta, no se filtra cuál.
      if (records.length !== input.ids.length) throw attachmentInvalid("Alguna imagen no se puede usar en este mensaje.");

      const heads = await Promise.all(records.map((r) => deps.storage.headObject(r.s3Key)));
      heads.forEach((head, i) => {
        const record = records[i];
        if (!head.exists) throw attachmentInvalid("Alguna imagen todavía no terminó de subirse.");
        if (head.contentType !== record.contentType || head.contentLength !== record.sizeBytes) {
          throw attachmentInvalid("Alguna imagen no coincide con el tipo o el tamaño declarados.");
        }
      });
    },

    /**
     * AC5: los adjuntos de cada mensaje con su URL firmada recién generada (vida corta, nunca persistida). Solo
     * consulta los mensajes que tienen adjuntos.
     */
    async viewsFor(messages: Array<{ id: string; attachmentCount: number }>): Promise<Map<string, SupportAttachment[]>> {
      const ids = messages.filter((m) => m.attachmentCount > 0).map((m) => m.id);
      const byMessage = new Map<string, SupportAttachment[]>();
      if (ids.length === 0) return byMessage;
      const records = await deps.repository.listForMessages(ids);
      const urls = await Promise.all(
        records.map((r) => deps.storage.createDownloadUrl(r.s3Key, { expiresIn: SUPPORT_ATTACHMENT_URL_TTL_SECONDS }))
      );
      records.forEach((record, i) => {
        if (!record.messageId) return;
        const list = byMessage.get(record.messageId) ?? [];
        list.push(toView(record, urls[i].url));
        byMessage.set(record.messageId, list);
      });
      return byMessage;
    },
  };
}

export type SupportAttachmentsService = ReturnType<typeof createSupportAttachmentsService>;
