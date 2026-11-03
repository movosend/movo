import { SupportAttachment, SupportInternalRow, SupportStreamEvent } from "@movo/shared";
import { toInternalMessage, toInternalRow } from "../../domain/support-admin-rules";
import { SupportMessageFacts } from "../../domain/support-rules";
import { SupportAdminRepository } from "../../repositories/support-admin-repository";
import { SupportEventStream } from "../../realtime/support-event-stream";
import { SupportAttachmentsService } from "../support/support-attachments.service";

type FeedLogger = { warn: (obj: unknown, msg?: string) => void };

/**
 * MOVO-322: arma los eventos del panel (`SupportStreamEvent`) con la fila de la bandeja ya actualizada y los escribe en
 * el stream. Lo usan las dos puntas: el lado del usuario (consulta nueva, mensaje del usuario) y el del agente. Nunca
 * falla al que llama: el cambio ya está guardado, y si el panel se pierde un evento lo recupera al refrescar (por eso
 * cada fallo solo se loguea). El lado del agente pasa la fila (`known`) que ya leyó para su respuesta, así no se relee.
 */
export interface SupportAdminFeed {
  conversationCreated(conversationId: string): Promise<void>;
  messagesAdded(conversationId: string, messages: SupportMessageFacts[], known?: KnownFeedState): Promise<void>;
  conversationUpdated(conversationId: string, known?: KnownFeedState): Promise<void>;
}

/** Lo que el que llama ya tiene: la fila actualizada y, si firmó, los adjuntos de los mensajes. */
export interface KnownFeedState {
  row?: SupportInternalRow;
  views?: Map<string, SupportAttachment[]>;
}

export interface SupportAdminFeedDeps {
  repository: SupportAdminRepository;
  attachments: SupportAttachmentsService;
  stream: SupportEventStream;
  logger?: FeedLogger;
  now?: () => Date;
}

export function createSupportAdminFeed(deps: SupportAdminFeedDeps): SupportAdminFeed {
  const now = deps.now ?? (() => new Date());

  async function rowOf(conversationId: string) {
    const row = await deps.repository.findRow(conversationId);
    return row ? toInternalRow(row.conversation, row.lastMessage, row.unread, now()) : null;
  }

  async function safely(conversationId: string, run: () => Promise<SupportStreamEvent[]>): Promise<void> {
    try {
      const events = await run();
      for (const event of [...events, { type: "counts_changed" } as const]) await deps.stream.publish(event);
    } catch (err) {
      deps.logger?.warn({ err, event: "support_admin_feed_failed", conversationId }, "No se pudo avisar al panel de soporte");
    }
  }

  return {
    async conversationCreated(conversationId) {
      await safely(conversationId, async () => {
        const conversation = await rowOf(conversationId);
        return conversation ? [{ type: "conversation_created", conversation }] : [];
      });
    },

    async messagesAdded(conversationId, messages, known) {
      await safely(conversationId, async () => {
        const conversation = known?.row ?? (await rowOf(conversationId));
        if (!conversation) return [];
        // Firmar puede fallar (storage caído): el evento sale igual, sin adjuntos; el panel los ve al pedir mensajes.
        let views = known?.views ?? new Map<string, SupportAttachment[]>();
        if (!known?.views) {
          try {
            views = await deps.attachments.viewsFor(messages);
          } catch (err) {
            deps.logger?.warn({ err, event: "support_admin_feed_sign_failed", conversationId }, "Evento del panel sin adjuntos");
          }
        }
        return messages.map((m) => ({
          type: "support_message" as const,
          conversation,
          message: toInternalMessage(m, views.get(m.id) ?? []),
        }));
      });
    },

    async conversationUpdated(conversationId, known) {
      await safely(conversationId, async () => {
        const conversation = known?.row ?? (await rowOf(conversationId));
        return conversation ? [{ type: "conversation_updated", conversation }] : [];
      });
    },
  };
}
