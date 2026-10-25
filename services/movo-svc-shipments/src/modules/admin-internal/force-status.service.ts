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
  simulatePayment?: boolean;
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
  forceStatus(
    shipmentId: string,
    input: ForceShipmentStatusRequest,
  ): Promise<ForceShipmentStatusResponse>;
}

const PARTY_TRIGGERS = {
  sender: "shipmentStatusForcedSender",
  receiver: "shipmentStatusForcedReceiver",
  carrier: "shipmentStatusForcedCarrier",
} as const satisfies Record<string, NotificationTriggerKey>;

export function createForceStatusService(
  deps: ForceStatusServiceDeps,
): ForceStatusService {
  const { repository, shipmentsService, fundingService, redis, logger } = deps;

  async function readStored(
    idempotencyKey: string,
  ): Promise<StoredResult | null> {
    const raw = await redis.get(idempotencyRedisKey(idempotencyKey));
    return raw ? (JSON.parse(raw) as StoredResult) : null;
  }

  function replayOrNull(
    stored: StoredResult | null,
    shipmentId: string,
    targetStatus: string,
    simulatePayment: boolean,
  ) {
    if (!stored) return null;
    if (
      stored.shipmentId !== shipmentId ||
      stored.targetStatus !== targetStatus ||
      (stored.simulatePayment ?? false) !== simulatePayment
    ) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Esa clave de idempotencia ya se usó para otro cambio.",
      );
    }
    return { ...stored.response, replayed: true };
  }

  /** El envío cambió entre la lectura y el servicio de dominio: el panel tiene que releer. */
  async function statusChanged(
    shipmentId: string,
    fallback: ShipmentStatus,
  ): Promise<ApiError> {
    const current = await repository.findById(shipmentId);
    return new ApiError(
      409,
      "STATUS_CHANGED",
      "El estado del envío cambió mientras confirmabas.",
      {
        currentStatus: current?.status ?? fallback,
      },
    );
  }

  async function execute(
    shipment: Shipment,
    input: ForceShipmentStatusRequest,
    cell: NonNullable<ReturnType<typeof getForcedTransition>>,
  ): Promise<void> {
    const admin: AdminStatusActor = {
      adminId: input.adminId,
      adminName: input.adminName,
      kind: cell.kind,
    };
    switch (cell.service) {
      case "cancelShipment":
        await shipmentsService.cancelShipment(
          shipment.id,
          shipment.senderId,
          input.reason,
          undefined,
          { admin },
        );
        return;
      case "withdrawCarrierFromShipment":
        if (!shipment.carrierId) {
          throw new ApiError(
            422,
            "TRANSITION_NOT_ALLOWED",
            "El envío no tiene transportista asignado.",
            {
              reason: "El envío no tiene transportista asignado.",
            },
          );
        }
        await shipmentsService.withdrawCarrierFromShipment(
          shipment.id,
          shipment.carrierId,
          input.reason,
          undefined,
          {
            admin,
          },
        );
        return;
      case "confirmFunding":
        await fundingService.confirmAssignmentByAdmin(
          shipment,
          admin,
          input.reason,
          { simulatePayment: input.simulatePayment === true },
        );
        return;
      case "captureAndComplete": {
        const outcome = await deps
          .settlements()
          .captureAndComplete(shipment.id, admin);
        if (outcome === "skipped") {
          throw new ApiError(
            422,
            "TRANSITION_NOT_ALLOWED",
            "El envío no tiene un cobro que capturar.",
            {
              reason: "El envío no tiene un cobro que capturar.",
            },
          );
        }
        return;
      }
    }
  }

  /** Aviso a las partes (DD-055): crítico, sin el motivo ni montos. Nunca tira: el cambio ya está hecho. */
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
            {
              err,
              event: "notification_dispatch_failed",
              shipmentId: shipment.id,
              userId,
            },
            "No se pudo avisar del cambio de estado forzado",
          );
        }
      }),
    );
  }

  async function sendAlert(
    alert: Parameters<AlertNotifier["send"]>[0],
  ): Promise<void> {
    await deps.alertNotifier.send(alert).catch((alertErr: unknown) => {
      logger.warn(
        {
          err: alertErr,
          event: "force_status_alert_failed",
          alert: alert.kind,
        },
        "No se pudo mandar la alerta",
      );
    });
  }

  /**
   * DD-055 (riesgo aceptado): `assigned -> cancelled` libera el hold ANTES de cancelar, y el handshake de
   * retiro puede ganar la carrera entre las dos cosas. Si pasó, el envío quedó `in_transit` sin fondos
   * retenidos: no hay forma de volver a autorizar el hold, así que se alerta al equipo con los ids.
   */
  async function alertHoldReleasedRace(
    shipment: Shipment,
    input: ForceShipmentStatusRequest,
  ): Promise<void> {
    const current = await repository.findById(shipment.id);
    logger.error(
      {
        event: "force_status_hold_released_race",
        shipmentId: shipment.id,
        currentStatus: current?.status,
      },
      "Se liberó el hold de un envío que el retiro movió a in_transit antes de cancelarlo",
    );
    await sendAlert({
      kind: "force_status_hold_released_race",
      message:
        "Se liberó el hold de un envío que ya está en tránsito: quedó sin fondos retenidos",
      context: {
        shipmentId: shipment.id,
        fromStatus: shipment.status,
        currentStatus: current?.status,
        adminId: input.adminId,
      },
    });
  }

  async function alertFailure(
    shipment: Shipment,
    input: ForceShipmentStatusRequest,
    err: unknown,
  ): Promise<void> {
    logger.error(
      {
        err,
        event: "force_status_failed",
        shipmentId: shipment.id,
        from: shipment.status,
        to: input.targetStatus,
      },
      "Falló un efecto del cambio forzado de estado",
    );
    await sendAlert({
      kind: "force_status_failed",
      message: "Falló un cambio forzado de estado; revisar el estado del envío",
      context: {
        shipmentId: shipment.id,
        fromStatus: shipment.status,
        toStatus: input.targetStatus,
        adminId: input.adminId,
      },
    });
  }

  return {
    async forceStatus(shipmentId, input) {
      const replayed = replayOrNull(
        await readStored(input.idempotencyKey),
        shipmentId,
        input.targetStatus,
        input.simulatePayment === true,
      );
      if (replayed) return replayed;

      const lockKey = lockRedisKey(shipmentId);
      const token = randomUUID();
      const locked = await redis.set(lockKey, token, "PX", LOCK_TTL_MS, "NX");
      if (locked !== "OK") {
        throw new ApiError(
          409,
          "FORCE_STATUS_IN_PROGRESS",
          "Hay otro cambio de estado en curso sobre este envío.",
        );
      }

      try {
        // Otra llamada con la misma clave pudo terminar entre la primera lectura y el lock.
        const again = replayOrNull(
          await readStored(input.idempotencyKey),
          shipmentId,
          input.targetStatus,
          input.simulatePayment === true,
        );
        if (again) return again;

        const shipment = await repository.findById(shipmentId);
        if (!shipment)
          throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");

        if (shipment.status !== input.expectedStatus) {
          throw new ApiError(
            409,
            "STATUS_CHANGED",
            "El estado del envío cambió mientras confirmabas.",
            {
              currentStatus: shipment.status,
            },
          );
        }

        // La matriz de `@movo/shared` manda: el panel nunca es la fuente de verdad.
        const cell = getForcedTransition(
          shipment.status,
          input.targetStatus as ShipmentStatus,
        );
        if (!cell) {
          const reason = blockedTransitionReason(
            shipment.status,
            input.targetStatus as ShipmentStatus,
          );
          throw new ApiError(422, "TRANSITION_NOT_ALLOWED", reason, { reason });
        }

        if (input.simulatePayment && cell.service !== "confirmFunding") {
          throw new ApiError(
            422,
            "VALIDATION_FAILED",
            "El pago simulado solo aplica al pasar a Asignado.",
          );
        }

        try {
          await execute(shipment, input, cell);
        } catch (err) {
          if (err instanceof ApiError && err.statusCode < 500) throw err;
          if (
            err instanceof ShipmentConcurrentModificationError ||
            err instanceof InvalidShipmentTransitionError
          ) {
            if (
              cell.service === "cancelShipment" &&
              shipment.status === ShipmentStatus.ASSIGNED
            ) {
              await alertHoldReleasedRace(shipment, input);
            }
            throw await statusChanged(shipmentId, shipment.status);
          }
          // Algo falló. Si el cambio alcanzó a aplicarse (falló un efecto posterior, como la liberación del
          // hold de una cancelación desde `assignment_pending`/`assigned_unfunded`), el pedido se cumplió.
          const after = await repository.findById(shipmentId);
          if (after?.status !== input.targetStatus) {
            // Si no, el servicio de dominio ordena el efecto externo ANTES del cambio de estado (y la baja
            // deshace su claim), así que el envío sigue como estaba. Se avisa al equipo; el panel reintenta.
            await alertFailure(shipment, input, err);
            throw new ApiError(
              502,
              "FORCE_STATUS_EFFECT_FAILED",
              "No se pudo completar el cambio. Revisá el estado del envío y reintentá.",
            );
          }
          logger.error(
            {
              err,
              event: "force_status_effect_failed_after_change",
              shipmentId,
              to: input.targetStatus,
            },
            "El estado ya cambió pero falló un efecto posterior del cambio forzado",
          );
          await sendAlert({
            kind: "force_status_effect_failed_after_change",
            message:
              "El estado de un envío cambió, pero falló un efecto posterior (revisar el hold)",
            context: {
              shipmentId,
              toStatus: input.targetStatus,
              adminId: input.adminId,
            },
          });
        }

        const response: ForceShipmentStatusResponse = {
          shipmentId,
          fromStatus: shipment.status,
          toStatus: input.targetStatus,
          kind: cell.kind,
          replayed: false,
        };
        const stored: StoredResult = {
          shipmentId,
          targetStatus: input.targetStatus,
          ...(input.simulatePayment ? { simulatePayment: true } : {}),
          response,
        };
        // Best-effort, como los avisos: el cambio ya está hecho, un Redis caído no puede convertirlo en un 500.
        try {
          await redis.set(
            idempotencyRedisKey(input.idempotencyKey),
            JSON.stringify(stored),
            "EX",
            IDEMPOTENCY_TTL_SECONDS,
          );
        } catch (err) {
          logger.warn(
            { err, event: "force_status_idempotency_save_failed", shipmentId },
            "No se pudo guardar la clave de idempotencia del cambio forzado",
          );
        }

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
        // Si falla, el lock vence solo (60 s); no puede enmascarar el resultado.
        await redis
          .eval(RELEASE_LOCK_IF_OWNER_SCRIPT, 1, lockKey, token)
          .catch((err: unknown) => {
            logger.warn(
              { err, event: "force_status_lock_release_failed", shipmentId },
              "No se pudo liberar el lock",
            );
          });
      }
    },
  };
}
