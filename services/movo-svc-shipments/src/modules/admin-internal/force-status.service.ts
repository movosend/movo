import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type Redis from "ioredis";
import {
  ApiError,
  blockedTransitionReason,
  ForceShipmentStatusRequest,
  ForceShipmentStatusResponse,
  getForcedTransition,
  NotificationTriggerKey,
  notificationTriggerCategory,
  renderNotificationTrigger,
  ShipmentStatus,
} from "@movo/shared";
import type { AlertNotifier } from "../../adapters/alert-notifier";
import type { NotificationsClient } from "../../adapters/notifications-client";
import type { AdminStatusActor } from "../../domain/admin-status-actor";
import { InvalidShipmentTransitionError } from "../../domain/shipment-state-machine";
import type { Shipment } from "../../models/shipment";
import {
  ShipmentConcurrentModificationError,
  type ShipmentRepository,
} from "../../repositories/shipment-repository";
import type { FundingService } from "../funding/funding.service";
import type { SettlementService } from "../settlements/settlement.service";
import type { ShipmentsService } from "../shipments/shipments.service";

/** Cuánto vive el lock por envío: más que cualquier servicio de dominio, menos que un cambio colgado. */
const LOCK_TTL_MS = 60_000;
/** El resultado guardado de una `idempotencyKey` (el panel reintenta dentro de la misma jornada). */
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

const RELEASE_LOCK_IF_OWNER_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

const idempotencyRedisKey = (key: string) => `force-status:idem:${key}`;
const lockRedisKey = (shipmentId: string) => `force-status:lock:${shipmentId}`;

interface StoredResult {
  shipmentId: string;
  targetStatus: string;
  response: ForceShipmentStatusResponse;
}

export interface ForceStatusServiceDeps {
  repository: ShipmentRepository;
  shipmentsService: ShipmentsService;
  fundingService: Pick<FundingService, "confirmAssignmentByAdmin">;
  /** Perezoso: `app.settlements` se decora después de registrar las rutas internas. */
  settlements: () => Pick<SettlementService, "captureAndComplete">;
  notificationsClient: NotificationsClient;
  alertNotifier: AlertNotifier;
  redis: Redis;
  logger: FastifyBaseLogger;
}

export interface ForceStatusService {
  forceStatus(shipmentId: string, input: ForceShipmentStatusRequest): Promise<ForceShipmentStatusResponse>;
}

const PARTY_TRIGGERS = {
  sender: "shipmentStatusForcedSender",
  receiver: "shipmentStatusForcedReceiver",
  carrier: "shipmentStatusForcedCarrier",
} as const satisfies Record<string, NotificationTriggerKey>;

export function createForceStatusService(deps: ForceStatusServiceDeps): ForceStatusService {
  const { repository, shipmentsService, fundingService, redis, logger } = deps;

  async function readStored(idempotencyKey: string): Promise<StoredResult | null> {
    const raw = await redis.get(idempotencyRedisKey(idempotencyKey));
    return raw ? (JSON.parse(raw) as StoredResult) : null;
  }

  function replayOrNull(stored: StoredResult | null, shipmentId: string, targetStatus: string) {
    if (!stored) return null;
    if (stored.shipmentId !== shipmentId || stored.targetStatus !== targetStatus) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Esa clave de idempotencia ya se usó para otro cambio.",
      );
    }
    return { ...stored.response, replayed: true };
  }

  /** El envío cambió entre la lectura y el servicio de dominio: el panel tiene que releer. */
  async function statusChanged(shipmentId: string, fallback: ShipmentStatus): Promise<ApiError> {
    const current = await repository.findById(shipmentId);
    return new ApiError(409, "STATUS_CHANGED", "El estado del envío cambió mientras confirmabas.", {
      currentStatus: current?.status ?? fallback,
    });
  }

  async function execute(
    shipment: Shipment,
    input: ForceShipmentStatusRequest,
    cell: NonNullable<ReturnType<typeof getForcedTransition>>,
  ): Promise<void> {
    const admin: AdminStatusActor = { adminId: input.adminId, adminName: input.adminName, kind: cell.kind };
    switch (cell.service) {
      case "cancelShipment":
        await shipmentsService.cancelShipment(shipment.id, shipment.senderId, input.reason, undefined, { admin });
        return;
      case "withdrawCarrierFromShipment":
        if (!shipment.carrierId) {
          throw new ApiError(422, "TRANSITION_NOT_ALLOWED", "El envío no tiene transportista asignado.", {
            reason: "El envío no tiene transportista asignado.",
          });
        }
        await shipmentsService.withdrawCarrierFromShipment(shipment.id, shipment.carrierId, input.reason, undefined, {
          admin,
        });
        return;
      case "confirmFunding":
        await fundingService.confirmAssignmentByAdmin(shipment, admin, input.reason);
        return;
      case "captureAndComplete": {
        const outcome = await deps.settlements().captureAndComplete(shipment.id, admin);
        if (outcome === "skipped") {
          throw new ApiError(422, "TRANSITION_NOT_ALLOWED", "El envío no tiene un cobro que capturar.", {
            reason: "El envío no tiene un cobro que capturar.",
          });
        }
        return;
      }
    }
  }

  /** Aviso a las partes (ADR-055): crítico, sin el motivo ni montos. Nunca tira: el cambio ya está hecho. */
  async function notifyParties(shipment: Shipment): Promise<void> {
    const targets = [
      { userId: shipment.senderId, role: "sender" as const },
      { userId: shipment.receiverId, role: "receiver" as const },
      // El snapshot de antes del cambio: la baja del transportista limpia `carrierId` del envío.
      { userId: shipment.carrierId, role: "carrier" as const },
    ];
    const notified = new Set<string>();
    await Promise.all(
      targets.map(async ({ userId, role }) => {
        if (!userId || notified.has(userId)) return;
        notified.add(userId);
        const trigger = PARTY_TRIGGERS[role];
        try {
          const { title, body } = renderNotificationTrigger(trigger, undefined);
          await deps.notificationsClient.sendPush({
            userId,
            title,
            body,
            category: notificationTriggerCategory(trigger),
            ignorePreferences: true,
            data: { type: "shipment", shipmentId: shipment.id },
          });
        } catch (err) {
          logger.warn(
            { err, event: "notification_dispatch_failed", shipmentId: shipment.id, userId },
            "No se pudo avisar del cambio de estado forzado",
          );
        }
      }),
    );
  }

  async function alertFailure(shipment: Shipment, input: ForceShipmentStatusRequest, err: unknown): Promise<void> {
    logger.error(
      { err, event: "force_status_failed", shipmentId: shipment.id, from: shipment.status, to: input.targetStatus },
      "Falló un efecto del cambio forzado de estado: el envío quedó en su estado original",
    );
    await deps.alertNotifier
      .send({
        kind: "force_status_failed",
        message: "Falló un cambio forzado de estado; el envío quedó en su estado original",
        context: {
          shipmentId: shipment.id,
          fromStatus: shipment.status,
          toStatus: input.targetStatus,
          adminId: input.adminId,
        },
      })
      .catch((alertErr: unknown) => {
        logger.warn({ err: alertErr, event: "force_status_alert_failed" }, "No se pudo mandar la alerta");
      });
  }

  return {
    async forceStatus(shipmentId, input) {
      const replayed = replayOrNull(await readStored(input.idempotencyKey), shipmentId, input.targetStatus);
      if (replayed) return replayed;

      const lockKey = lockRedisKey(shipmentId);
      const token = randomUUID();
      const locked = await redis.set(lockKey, token, "PX", LOCK_TTL_MS, "NX");
      if (locked !== "OK") {
        throw new ApiError(409, "FORCE_STATUS_IN_PROGRESS", "Hay otro cambio de estado en curso sobre este envío.");
      }

      try {
        // Otra llamada con la misma clave pudo terminar entre la primera lectura y el lock.
        const again = replayOrNull(await readStored(input.idempotencyKey), shipmentId, input.targetStatus);
        if (again) return again;

        const shipment = await repository.findById(shipmentId);
        if (!shipment) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");

        if (shipment.status !== input.expectedStatus) {
          throw new ApiError(409, "STATUS_CHANGED", "El estado del envío cambió mientras confirmabas.", {
            currentStatus: shipment.status,
          });
        }

        // La matriz de `@movo/shared` manda: el panel nunca es la fuente de verdad.
        const cell = getForcedTransition(shipment.status, input.targetStatus as ShipmentStatus);
        if (!cell) {
          const reason = blockedTransitionReason(shipment.status, input.targetStatus as ShipmentStatus);
          throw new ApiError(422, "TRANSITION_NOT_ALLOWED", reason, { reason });
        }

        try {
          await execute(shipment, input, cell);
        } catch (err) {
          if (err instanceof ApiError && err.statusCode < 500) throw err;
          if (err instanceof ShipmentConcurrentModificationError || err instanceof InvalidShipmentTransitionError) {
            throw await statusChanged(shipmentId, shipment.status);
          }
          // Un efecto externo falló. Los servicios de dominio ordenan el efecto ANTES del cambio de
          // estado, así que el envío sigue como estaba: se avisa al equipo y el panel puede reintentar.
          await alertFailure(shipment, input, err);
          throw new ApiError(
            502,
            "FORCE_STATUS_EFFECT_FAILED",
            "No se pudo completar el cambio: el envío quedó en su estado original.",
          );
        }

        const response: ForceShipmentStatusResponse = {
          shipmentId,
          fromStatus: shipment.status,
          toStatus: input.targetStatus,
          kind: cell.kind,
          replayed: false,
        };
        const stored: StoredResult = { shipmentId, targetStatus: input.targetStatus, response };
        await redis.set(idempotencyRedisKey(input.idempotencyKey), JSON.stringify(stored), "EX", IDEMPOTENCY_TTL_SECONDS);

        logger.warn(
          {
            event: "shipment_status_forced",
            shipmentId,
            from: shipment.status,
            to: input.targetStatus,
            kind: cell.kind,
            adminId: input.adminId,
          },
          "Un admin cambió el estado de un envío",
        );
        await notifyParties(shipment);
        return response;
      } finally {
        await redis.eval(RELEASE_LOCK_IF_OWNER_SCRIPT, 1, lockKey, token);
      }
    },
  };
}
