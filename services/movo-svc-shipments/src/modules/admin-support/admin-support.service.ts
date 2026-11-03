import {
  ApiError,
  SupportAttachmentCreateResult,
  SupportInternalAgentLoad,
  SupportInternalAttachmentBody,
  SupportInternalCounts,
  SupportInternalCountsQuery,
  SupportInternalListPage,
  SupportInternalListQuery,
  SupportInternalMessagesPage,
  SupportInternalParties,
  SupportInternalPatchBody,
  SupportInternalActor,
  SupportInternalRow,
  SupportInternalSendBody,
  SupportInternalSendResult,
  SupportInternalUserConversations,
  SUPPORT_LIST_PAGE_SIZE,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_MESSAGES_PAGE_SIZE,
} from "@movo/shared";
import { toInternalMessage, toInternalRow } from "../../domain/support-admin-rules";
import { SupportMessageFacts } from "../../domain/support-rules";
import {
  InvalidSupportAdminCursorError,
  SupportAdminRepository,
  SupportAdminRow,
} from "../../repositories/support-admin-repository";
import { SupportAttachmentClaimError } from "../../repositories/support-attachment-repository";
import { SupportConversationRecord } from "../../repositories/support-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { hasShipmentAccess } from "../shipments/assert-shipment-access";
import { attachmentInvalid, SupportAttachmentsService } from "../support/support-attachments.service";
import { SupportService } from "../support/support.service";
import { SupportAdminFeed } from "./support-admin-feed";

/** Cuántas consultas anteriores del mismo usuario trae el contexto (AC10). */
const USER_CONVERSATIONS_LIMIT = 20;

export interface AdminSupportServiceDeps {
  repository: SupportAdminRepository;
  attachments: SupportAttachmentsService;
  shipmentRepository: ShipmentRepository;
  /** Lo que ve el usuario (WebSocket, push, tildes): el mismo servicio que usan las rutas de `/support`. */
  userSide: SupportService;
  feed: SupportAdminFeed;
  logger?: { warn: (obj: unknown, msg?: string) => void };
  now?: () => Date;
}

function notFound(): ApiError {
  return new ApiError(404, "SUPPORT_CONVERSATION_NOT_FOUND", "La consulta no existe.");
}

/**
 * MOVO-322: el lado del agente de la bandeja de soporte. Lo llama solo `svc-admin` (endpoints internos), que ya aplicó
 * el rol, la regla de conflicto de interés y la bitácora; acá se aplican las reglas del modelo y se avisa a las dos
 * puntas: al usuario (`userSide`, sin notas ni eventos del equipo) y al panel (`feed`).
 */
export function createAdminSupportService(deps: AdminSupportServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const repo = deps.repository;

  const rowOf = (row: SupportAdminRow): SupportInternalRow => toInternalRow(row.conversation, row.lastMessage, row.unread, now());

  async function existingRow(id: string): Promise<SupportAdminRow> {
    const row = await repo.findRow(id);
    if (!row) throw notFound();
    return row;
  }

  function cursorErrors<T>(run: () => Promise<T>): Promise<T> {
    return run().catch((err: unknown) => {
      if (err instanceof InvalidSupportAdminCursorError) throw new ApiError(400, "VALIDATION_FAILED", err.message);
      throw err;
    });
  }

  /** Avisa al panel de los eventos del equipo que dejó una acción, con la fila que ya se leyó para la respuesta. */
  async function publishEvents(conversationId: string, events: SupportMessageFacts[], row: SupportInternalRow): Promise<void> {
    if (events.length > 0) await deps.feed.messagesAdded(conversationId, events, { row });
    else await deps.feed.conversationUpdated(conversationId, { row });
  }

  /**
   * Avisa al usuario (WebSocket, push) sin romper la respuesta: el cambio ya está confirmado, y un 500 acá haría que el
   * reintento del panel caiga en el replay sin avisar a nadie y que `svc-admin` registre como fallida una acción hecha.
   * El usuario lo ve igual al refrescar.
   */
  async function toUser(conversationId: string, run: () => Promise<void> | void): Promise<void> {
    try {
      await run();
    } catch (err) {
      deps.logger?.warn({ err, event: "support_user_publish_failed", conversationId }, "No se pudo avisar al usuario de soporte");
    }
  }

  return {
    async list(query: SupportInternalListQuery): Promise<SupportInternalListPage> {
      const page = await cursorErrors(() => repo.list(query, SUPPORT_LIST_PAGE_SIZE));
      return { items: page.items.map(rowOf), nextCursor: page.nextCursor };
    },

    counts(query: SupportInternalCountsQuery): Promise<SupportInternalCounts> {
      return repo.counts(query);
    },

    async get(id: string): Promise<SupportInternalRow> {
      return rowOf(await existingRow(id));
    },

    /** AC4: todos los `kind` (notas y eventos incluidos), más recientes primero, con URLs firmadas al leer. */
    async messages(id: string, cursor?: string): Promise<SupportInternalMessagesPage> {
      await existingRow(id);
      const page = await cursorErrors(() => repo.listMessages(id, SUPPORT_MESSAGES_PAGE_SIZE, cursor));
      const views = await deps.attachments.viewsFor(page.items);
      return { items: page.items.map((m) => toInternalMessage(m, views.get(m.id) ?? [])), nextCursor: page.nextCursor };
    },

    /**
     * AC5: respuesta o nota (`internal`). Una respuesta pasa la consulta a `awaiting_user`, la toma si estaba sin asignar
     * y reabre una resuelta (con sus eventos). Idempotente por `clientMessageId`: el reenvío devuelve lo guardado.
     */
    async send(id: string, input: SupportInternalSendBody): Promise<SupportInternalSendResult> {
      const row = await existingRow(id);
      const replay = async (message: SupportMessageFacts): Promise<SupportInternalSendResult> => {
        const views = await deps.attachments.viewsFor([message]);
        return { message: toInternalMessage(message, views.get(message.id) ?? []), conversation: rowOf(row) };
      };
      // Reenvío: antes de validar los adjuntos, que el original ya usó.
      const existing = await repo.findStaffMessageByClientId(id, input.clientMessageId);
      if (existing) return replay(existing);

      const attachmentIds = input.attachmentIds ?? [];
      const body = input.body.trim();
      if ((body.length === 0 && attachmentIds.length === 0) || body.length > SUPPORT_MESSAGE_MAX_LENGTH) {
        throw new ApiError(400, "VALIDATION_FAILED", `El mensaje debe tener entre 1 y ${SUPPORT_MESSAGE_MAX_LENGTH} caracteres.`);
      }
      // MOVO-321: el HEAD contra S3 va acá, antes de la transacción (el claim repite cantidad y repetidos).
      await deps.attachments.assertUsable({
        ids: attachmentIds,
        uploaderId: input.actorId,
        uploaderKind: "staff",
        conversationId: id,
      });
      let result;
      try {
        result = await repo.appendAgentMessage({
          conversationId: id,
          agentId: input.actorId,
          agentFirstName: input.actorFirstName,
          agentFullName: input.actorFullName,
          body,
          clientMessageId: input.clientMessageId,
          internal: input.internal ?? false,
          attachmentIds,
          now: now(),
        });
      } catch (err) {
        if (!(err instanceof SupportAttachmentClaimError)) throw err;
        const raced = await repo.findStaffMessageByClientId(id, input.clientMessageId);
        if (raced) return replay(raced);
        throw attachmentInvalid("Alguna imagen no se puede usar en este mensaje.");
      }

      // Una sola lectura de la fila y una sola firma de adjuntos, para la respuesta y para el panel (los eventos del
      // equipo no llevan adjuntos).
      const [views, fresh] = await Promise.all([deps.attachments.viewsFor([result.message]), existingRow(id)]);
      const conversationRow = rowOf(fresh);
      if (result.created) {
        // Al usuario: la respuesta (WS + push) y el cambio de estado. Una nota no le llega por ningún camino
        // (`publishStaffMessage` la descarta), ni los eventos del equipo.
        const conversation = result.conversation as SupportConversationRecord;
        await toUser(id, async () => {
          await deps.userSide.publishStaffMessage(conversation, result.message);
          if (result.statusChanged) deps.userSide.publishStatus(conversation);
        });
        await deps.feed.messagesAdded(id, [...result.events, result.message], { row: conversationRow, views });
      }
      return { message: toInternalMessage(result.message, views.get(result.message.id) ?? []), conversation: conversationRow };
    },

    /** AC6/AC7: asignación, prioridad, tema, etiquetas y envío vinculado; cada cambio (salvo etiquetas) deja su evento. */
    async patch(id: string, input: SupportInternalPatchBody): Promise<SupportInternalRow> {
      const row = await existingRow(id);
      if (typeof input.shipmentId === "string") {
        const shipment = await deps.shipmentRepository.findById(input.shipmentId);
        // Sin roles: el que tiene que ser parte es el usuario de la consulta, no el agente. Inexistente da lo mismo.
        if (!shipment || !hasShipmentAccess(shipment, row.conversation.userId, [])) {
          throw new ApiError(422, "SUPPORT_SHIPMENT_NOT_PARTY", "El usuario de la consulta no es parte de ese envío.");
        }
      }
      const result = await repo.applyPatch({
        conversationId: id,
        actorId: input.actorId,
        actorFullName: input.actorFullName,
        ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
        ...(input.assigneeFullName ? { assigneeFullName: input.assigneeFullName } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.topic ? { topic: input.topic } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.shipmentId !== undefined ? { shipmentId: input.shipmentId } : {}),
        now: now(),
      });
      if (!result.changed) return rowOf(row);
      const fresh = rowOf(await existingRow(id));
      await publishEvents(id, result.events, fresh);
      return fresh;
    },

    /** AC8: resolver o reabrir, con su evento; el usuario ve el cambio de estado. Idempotente. */
    async setResolved(id: string, actor: SupportInternalActor, resolved: boolean): Promise<SupportInternalRow> {
      const row = await existingRow(id);
      const result = await repo.setResolved({ conversationId: id, actorId: actor.actorId, actorFullName: actor.actorFullName, resolved, now: now() });
      if (!result.changed) return rowOf(row);
      const fresh = rowOf(await existingRow(id));
      await toUser(id, () => deps.userSide.publishStatus(result.conversation as SupportConversationRecord));
      await publishEvents(id, result.events, fresh);
      return fresh;
    },

    /** Un agente abrió la consulta: no leídos compartidos a cero y tildes "leído" para el usuario. Es una lectura. */
    async read(id: string): Promise<void> {
      const row = await existingRow(id);
      await deps.userSide.publishAgentRead(id, row.conversation.userId, now());
      await deps.feed.conversationUpdated(id);
    },

    agentLoads(): Promise<SupportInternalAgentLoad[]> {
      return repo.agentLoads().then((rows) => rows.map((r) => ({ agentId: r.agentId, activeCount: r.activeCount })));
    },

    /** Para la regla de conflicto de interés de `svc-admin`: el admin es parte si es el usuario de la consulta. */
    async parties(id: string): Promise<SupportInternalParties> {
      return { userId: (await existingRow(id)).conversation.userId };
    },

    /** AC10: las demás consultas del mismo usuario. */
    async userConversations(id: string): Promise<SupportInternalUserConversations> {
      const row = await existingRow(id);
      return { items: await repo.userConversations(row.conversation.userId, id, USER_CONVERSATIONS_LIMIT) };
    },

    /** MOVO-321 desde el panel: URL de subida de un adjunto del agente, en el prefijo de esta consulta. */
    async createAttachment(id: string, input: SupportInternalAttachmentBody): Promise<SupportAttachmentCreateResult> {
      await existingRow(id);
      return deps.attachments.create({
        uploaderId: input.actorId,
        uploaderKind: "staff",
        conversationId: id,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
      });
    },
  };
}

export type AdminSupportService = ReturnType<typeof createAdminSupportService>;
