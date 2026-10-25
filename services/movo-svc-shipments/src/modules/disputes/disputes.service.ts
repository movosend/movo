import { randomUUID } from "node:crypto";
import { FastifyBaseLogger } from "fastify";
import type Redis from "ioredis";
import {
  ApiError,
  DISPUTE_WINDOW_DAYS,
  DisputeDetail,
  DisputePartyRole,
  DisputePhoto,
  DisputePhotoUploadUrl,
  DisputeReason,
  DisputeStatus,
  MAX_REPORT_PHOTOS_PER_SUBMISSION,
  ShipmentStatus,
  USER_SELECTABLE_DISPUTE_REASONS,
  notificationTriggerCategory,
  renderNotificationTrigger,
} from "@movo/shared";
import { Shipment } from "../../models/shipment";
import {
  ShipmentConcurrentModificationError,
  ShipmentRepository,
} from "../../repositories/shipment-repository";
import {
  DisputeAlreadyOpenError,
  DisputeNotOpenError,
  DisputePhotoAlreadyUsedError,
  DisputePhotoRecord,
  DisputeRepository,
  DisputeStatementAlreadySubmittedError,
  DisputeWithDetails,
} from "../../repositories/dispute-repository";
import { StorageProvider } from "../../adapters/storage-provider";
import { NotificationsClient } from "../../adapters/notifications-client";
import { AlertNotifier } from "../../adapters/alert-notifier";
import {
  assertValidPhotoConstraints,
  PENDING_PHOTOS_REDIS_KEY,
  photoConfirmationLockKey,
  PHOTO_CONFIRMATION_LOCK_TTL_MS,
} from "../shipments/photos.service";

const DISPUTE_WINDOW_MS = DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Libera el lock solo si sigue siendo nuestro (mismo script que los reportes de MOVO-256). */
const RELEASE_LOCK_IF_OWNER_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

/**
 * MOVO-334: las fotos de una disputa viven bajo el envío, separadas por autor. El prefijo por
 * usuario es lo que impide asociar fotos que subió otra parte.
 */
export function disputePhotoPrefix(shipmentId: string, userId: string): string {
  return `shipments/${shipmentId}/disputes/${userId}/`;
}

/** Rol de la persona dentro del envío, o `null` si no es parte (un admin tampoco lo es). */
export function disputePartyRole(
  shipment: Shipment,
  userId: string,
): DisputePartyRole | null {
  if (userId === shipment.senderId) return "sender";
  if (userId === shipment.receiverId) return "receiver";
  if (shipment.carrierId !== null && userId === shipment.carrierId)
    return "carrier";
  return null;
}

/**
 * MOVO-334 (AC2, DD-054): desde qué estados una parte puede abrir una disputa. `in_transit`
 * siempre; `delivered`/`completed` dentro de `DISPUTE_WINDOW_DAYS` desde `deliveredAt`. Un
 * `assigned` no: solo lo pasa a disputa el barrido de no-retiro.
 */
export function assertDisputeOpenable(shipment: Shipment, now: Date): void {
  if (shipment.status === ShipmentStatus.IN_TRANSIT) return;
  if (
    shipment.status === ShipmentStatus.DELIVERED ||
    shipment.status === ShipmentStatus.COMPLETED
  ) {
    if (
      shipment.deliveredAt &&
      now.getTime() - shipment.deliveredAt.getTime() <= DISPUTE_WINDOW_MS
    )
      return;
    throw new ApiError(
      422,
      "DISPUTE_WINDOW_EXPIRED",
      `Pasaron más de ${DISPUTE_WINDOW_DAYS} días desde la entrega: ya no se puede abrir una disputa.`,
    );
  }
  throw new ApiError(
    422,
    "DISPUTE_NOT_ALLOWED",
    "El envío no está en un estado en el que se pueda abrir una disputa.",
  );
}

export interface OpenDisputeInput {
  shipmentId: string;
  callerId: string;
  reason: DisputeReason;
  description: string;
  photoKeys: string[];
}

export interface AddStatementInput {
  disputeId: string;
  callerId: string;
  text: string;
  photoKeys: string[];
}

export interface PresignDisputePhotoInput {
  shipmentId: string;
  callerId: string;
  contentType: string;
  contentLength: number;
}

export interface DisputesServiceDeps {
  shipmentRepository: ShipmentRepository;
  disputeRepository: DisputeRepository;
  storageProvider: StorageProvider;
  redis: Redis;
  notificationsClient: NotificationsClient;
  alertNotifier: AlertNotifier;
  logger: FastifyBaseLogger;
  now?: () => Date;
}

export interface DisputesService {
  presignPhoto(input: PresignDisputePhotoInput): Promise<DisputePhotoUploadUrl>;
  openDispute(input: OpenDisputeInput): Promise<DisputeDetail>;
  addStatement(input: AddStatementInput): Promise<DisputeDetail>;
  getDispute(disputeId: string, callerId: string): Promise<DisputeDetail>;
}

const DISPUTE_PUSH_TRIGGERS = {
  sender: "disputeOpenedSender",
  receiver: "disputeOpenedReceiver",
  carrier: "disputeOpenedCarrier",
} as const;

export function createDisputesService(
  deps: DisputesServiceDeps,
): DisputesService {
  const {
    shipmentRepository,
    disputeRepository,
    storageProvider,
    redis,
    logger,
  } = deps;
  const now = deps.now ?? (() => new Date());

  async function loadShipment(shipmentId: string): Promise<Shipment> {
    const shipment = await shipmentRepository.findById(shipmentId);
    if (!shipment) {
      throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
    }
    return shipment;
  }

  function requireParty(
    shipment: Shipment,
    callerId: string,
  ): DisputePartyRole {
    const role = disputePartyRole(shipment, callerId);
    if (!role) {
      throw new ApiError(
        403,
        "AUTH_FORBIDDEN",
        "Solo el emisor, el receptor o el transportista del envío pueden hacer esto.",
      );
    }
    return role;
  }

  async function alreadyOpen(shipmentId: string): Promise<ApiError> {
    const existing = await disputeRepository.findOpenByShipment(shipmentId);
    return new ApiError(
      409,
      "DISPUTE_ALREADY_OPEN",
      "Ya hay una disputa abierta sobre este envío.",
      {
        disputeId: existing?.id ?? null,
      },
    );
  }

  /**
   * Mismo esquema que los reportes de MOVO-256: toma el lock de cada key (el mismo que el sweep
   * de fotos huérfanas toma antes de borrar), valida prefijo, objeto real en S3 y que no estén ya
   * en otra disputa. Devuelve la función que libera los locks; el caller la corre después de
   * persistir, así el sweep no puede borrar una foto entre la validación y el INSERT.
   */
  async function lockAndValidatePhotoKeys(
    prefix: string,
    keys: string[],
  ): Promise<() => Promise<void>> {
    if (keys.length === 0) return async () => {};
    if (new Set(keys).size !== keys.length) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "Mandaste la misma foto más de una vez.",
      );
    }
    if (keys.length > MAX_REPORT_PHOTOS_PER_SUBMISSION) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        `Podés mandar hasta ${MAX_REPORT_PHOTOS_PER_SUBMISSION} fotos por vez.`,
      );
    }
    if (keys.some((key) => !key.startsWith(prefix))) {
      throw new ApiError(
        403,
        "PHOTO_FORBIDDEN_KEY",
        "La imagen no pertenece al usuario autenticado.",
      );
    }

    const acquired: Array<{ lockKey: string; token: string }> = [];
    const release = async () => {
      await Promise.all(
        acquired.map(({ lockKey, token }) =>
          redis.eval(RELEASE_LOCK_IF_OWNER_SCRIPT, 1, lockKey, token),
        ),
      );
    };
    try {
      for (const key of keys) {
        const lockKey = photoConfirmationLockKey(key);
        const token = randomUUID();
        const ok = await redis.set(
          lockKey,
          token,
          "PX",
          PHOTO_CONFIRMATION_LOCK_TTL_MS,
          "NX",
        );
        if (ok !== "OK") {
          throw new ApiError(
            409,
            "PHOTO_CONFIRMATION_IN_PROGRESS",
            "Hay una verificación en curso para una de las imágenes, reintentá en unos segundos.",
          );
        }
        acquired.push({ lockKey, token });
      }

      const [heads, associated] = await Promise.all([
        Promise.all(keys.map((key) => storageProvider.headObject(key))),
        disputeRepository.findAssociatedPhotoKeys(keys),
      ]);
      if (heads.some((head) => !head.exists)) {
        throw new ApiError(
          422,
          "PHOTO_OBJECT_NOT_FOUND",
          "Una de las imágenes no terminó de subirse.",
        );
      }
      for (const head of heads) {
        if (
          head.contentType !== undefined &&
          head.contentLength !== undefined
        ) {
          assertValidPhotoConstraints(head.contentType, head.contentLength);
        }
      }
      if (associated.length > 0) {
        throw photoAlreadyUsed();
      }
      return release;
    } catch (error) {
      await release();
      throw error;
    }
  }

  function photoAlreadyUsed(): ApiError {
    return new ApiError(
      409,
      "DISPUTE_PHOTO_ALREADY_USED",
      "Una de las imágenes ya está en una disputa.",
    );
  }

  /** Best-effort: si el ZREM falla, el sweep igual revalida contra Postgres antes de borrar. */
  async function untrackPhotoKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await redis.zrem(PENDING_PHOTOS_REDIS_KEY, ...keys);
    } catch (error) {
      logger.warn(
        {
          keys,
          event: "dispute_photo_untrack_failed",
          error: (error as Error).message,
        },
        "No se pudo remover el tracking de Redis de las fotos de la disputa",
      );
    }
  }

  async function toPhotoDtos(
    photos: DisputePhotoRecord[],
  ): Promise<DisputePhoto[]> {
    return Promise.all(
      photos.map(async (photo) => {
        const { url, expiresIn } = await storageProvider.createDownloadUrl(
          photo.s3Key,
        );
        return { id: photo.id, url, expiresIn };
      }),
    );
  }

  async function toDetail(dispute: DisputeWithDetails): Promise<DisputeDetail> {
    return {
      id: dispute.id,
      shipmentId: dispute.shipmentId,
      openedBy: dispute.openedBy,
      openedByRole: dispute.openedByRole,
      reason: dispute.reason,
      description: dispute.description,
      status: dispute.status,
      openedAt: dispute.openedAt.toISOString(),
      photos: await toPhotoDtos(dispute.photos),
      statements: await Promise.all(
        dispute.statements.map(async (statement) => ({
          id: statement.id,
          authorId: statement.authorId,
          authorRole: statement.authorRole,
          kind: statement.kind,
          text: statement.text,
          photos: await toPhotoDtos(statement.photos),
          createdAt: statement.createdAt.toISOString(),
        })),
      ),
    };
  }

  async function loadDetail(disputeId: string): Promise<DisputeWithDetails> {
    const dispute = await disputeRepository.findById(disputeId);
    if (!dispute) {
      throw new ApiError(404, "DISPUTE_NOT_FOUND", "Disputa no encontrada.");
    }
    return dispute;
  }

  /** AC11: push a las tres partes (también a quien la abrió) y alerta al equipo. Nunca lanza. */
  async function notifyOpened(
    shipment: Shipment,
    disputeId: string,
    reason: DisputeReason,
    openedByRole: DisputePartyRole,
  ) {
    const targets: Array<{ userId: string | null; role: DisputePartyRole }> = [
      { userId: shipment.senderId, role: "sender" },
      { userId: shipment.receiverId, role: "receiver" },
      { userId: shipment.carrierId, role: "carrier" },
    ];
    await Promise.all([
      ...targets.map(async ({ userId, role }) => {
        if (!userId) return;
        const trigger = DISPUTE_PUSH_TRIGGERS[role];
        try {
          const { title, body } = renderNotificationTrigger(trigger, undefined);
          await deps.notificationsClient.sendPush({
            userId,
            title,
            body,
            category: notificationTriggerCategory(trigger),
            data: {
              type: "dispute_opened",
              disputeId,
              shipmentId: shipment.id,
            },
          });
        } catch (err) {
          logger.warn(
            {
              err,
              event: "notification_dispatch_failed",
              shipmentId: shipment.id,
              disputeId,
              userId,
            },
            "No se pudo enviar la push de disputa abierta",
          );
        }
      }),
      deps.alertNotifier
        .send({
          kind: "dispute_opened",
          message: "Una de las partes abrió una disputa",
          context: {
            disputeId,
            shipmentId: shipment.id,
            reason,
            openedByRole,
            fromStatus: shipment.status,
          },
        })
        .catch((err: unknown) => {
          logger.warn(
            { err, event: "dispute_alert_failed", disputeId },
            "No se pudo mandar la alerta de disputa",
          );
        }),
    ]);
  }

  return {
    async presignPhoto(input) {
      const shipment = await loadShipment(input.shipmentId);
      requireParty(shipment, input.callerId);
      assertValidPhotoConstraints(input.contentType, input.contentLength);

      const s3Key = `${disputePhotoPrefix(shipment.id, input.callerId)}${randomUUID()}.jpg`;
      const { uploadUrl, expiresIn } = await storageProvider.createUploadUrl({
        key: s3Key,
        contentType: input.contentType,
        contentLength: input.contentLength,
      });
      // Mismo tracking que las fotos del envío (MOVO-124): si nunca se asocia, el sweep la borra.
      try {
        await redis.zadd(PENDING_PHOTOS_REDIS_KEY, Date.now(), s3Key);
      } catch (error) {
        logger.warn(
          {
            shipmentId: shipment.id,
            s3Key,
            event: "photo_pending_track_failed",
            error: (error as Error).message,
          },
          "No se pudo registrar la foto de disputa como pendiente en Redis",
        );
      }
      return { uploadUrl, s3Key, expiresIn };
    },

    async openDispute(input) {
      if (!USER_SELECTABLE_DISPUTE_REASONS.includes(input.reason)) {
        throw new ApiError(
          400,
          "VALIDATION_FAILED",
          "Ese motivo no se puede elegir al abrir una disputa.",
        );
      }
      const shipment = await loadShipment(input.shipmentId);
      const role = requireParty(shipment, input.callerId);
      if (shipment.status === ShipmentStatus.DISPUTED) {
        throw await alreadyOpen(shipment.id);
      }
      assertDisputeOpenable(shipment, now());

      const release = await lockAndValidatePhotoKeys(
        disputePhotoPrefix(shipment.id, input.callerId),
        input.photoKeys,
      );
      const disputeId = randomUUID();
      try {
        // AC12: no se toca el hold. Con el envío `completed` el cobro ya está acreditado; qué se
        // devuelve lo decide MOVO-34/MOVO-337.
        await shipmentRepository.updateStatus(
          shipment.id,
          ShipmentStatus.DISPUTED,
          input.callerId,
          `Disputa abierta por una de las partes (${role})`,
          {
            expectedFrom: shipment.status,
            dispute: {
              id: disputeId,
              openedBy: input.callerId,
              openedByRole: role,
              reason: input.reason,
              description: input.description,
              photoKeys: input.photoKeys,
            },
          },
        );
      } catch (error) {
        if (error instanceof DisputeAlreadyOpenError)
          throw await alreadyOpen(shipment.id);
        if (error instanceof DisputePhotoAlreadyUsedError)
          throw photoAlreadyUsed();
        if (error instanceof ShipmentConcurrentModificationError) {
          // Otra parte (o el barrido) lo pasó a disputa entre la lectura y la transición.
          const existing = await disputeRepository.findOpenByShipment(
            shipment.id,
          );
          if (existing) throw await alreadyOpen(shipment.id);
        }
        throw error;
      } finally {
        await release();
      }
      await untrackPhotoKeys(input.photoKeys);

      logger.warn(
        {
          event: "dispute_opened",
          disputeId,
          shipmentId: shipment.id,
          reason: input.reason,
          openedByRole: role,
        },
        "Una de las partes abrió una disputa",
      );
      await notifyOpened(shipment, disputeId, input.reason, role);
      return toDetail(await loadDetail(disputeId));
    },

    async addStatement(input) {
      const dispute = await loadDetail(input.disputeId);
      const shipment = await loadShipment(dispute.shipmentId);
      const role = requireParty(shipment, input.callerId);
      if (dispute.status !== DisputeStatus.OPEN) {
        throw new ApiError(
          409,
          "DISPUTE_NOT_OPEN",
          "La disputa ya no está abierta.",
        );
      }
      // AC9: quien abrió amplía su evidencia una vez; cada otra parte carga un descargo. En una
      // disputa de sistema (`openedBy: null`) todas las partes cargan descargo.
      const kind =
        dispute.openedBy === input.callerId ? "amendment" : "statement";

      const release = await lockAndValidatePhotoKeys(
        disputePhotoPrefix(shipment.id, input.callerId),
        input.photoKeys,
      );
      try {
        await disputeRepository.addStatement({
          disputeId: dispute.id,
          authorId: input.callerId,
          authorRole: role,
          kind,
          text: input.text,
          photoKeys: input.photoKeys,
        });
      } catch (error) {
        if (error instanceof DisputeNotOpenError) {
          throw new ApiError(
            409,
            "DISPUTE_NOT_OPEN",
            "La disputa ya no está abierta.",
          );
        }
        if (error instanceof DisputeStatementAlreadySubmittedError) {
          throw new ApiError(
            409,
            "DISPUTE_STATEMENT_ALREADY_SUBMITTED",
            kind === "amendment"
              ? "Ya ampliaste la evidencia de esta disputa."
              : "Ya cargaste tu descargo en esta disputa.",
          );
        }
        if (error instanceof DisputePhotoAlreadyUsedError)
          throw photoAlreadyUsed();
        throw error;
      } finally {
        await release();
      }
      await untrackPhotoKeys(input.photoKeys);
      return toDetail(await loadDetail(dispute.id));
    },

    async getDispute(disputeId, callerId) {
      const dispute = await loadDetail(disputeId);
      const shipment = await loadShipment(dispute.shipmentId);
      requireParty(shipment, callerId);
      return toDetail(dispute);
    },
  };
}
