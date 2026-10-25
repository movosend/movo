import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type Redis from "ioredis";
import {
  AdminDisputeResolutionPreview,
  ApiError,
  computeNetFromGross,
  DISPUTE_PARTIAL_PRESETS,
  DISPUTE_REASONING_MAX_LENGTH,
  DISPUTE_REASONING_MIN_LENGTH,
  DisputeOutcome,
  DisputePartyRole,
  DisputePaymentAction,
  DisputeReason,
  DisputeResolvableStatus,
  DisputeStatus,
  disputeFinalShipmentStatus,
  disputePaymentAction,
  disputeRatingWinners,
  InternalResolveDisputeRequest,
  isDisputeResolvableStatus,
  minimumPartialCaptureArs,
  notificationTriggerCategory,
  renderNotificationTrigger,
  ResolveDisputeResponse,
  ShipmentStatus,
  splitDisputeStake,
} from "@movo/shared";
import type { AlertNotifier } from "../../adapters/alert-notifier";
import type { NotificationsClient } from "../../adapters/notifications-client";
import type { PaymentsClient } from "../../adapters/payments-client";
import type {
  DisputeRecord,
  DisputeRepository,
  DisputeResolutionRecord,
} from "../../repositories/dispute-repository";
import {
  ShipmentConcurrentModificationError,
  type ShipmentRepository,
} from "../../repositories/shipment-repository";
import type { Shipment } from "../../models/shipment";
import { InvalidShipmentTransitionError } from "../../domain/shipment-state-machine";

/** Más que una captura (50 s) más una lectura: un segundo pedido no puede pisar uno en curso. */
const LOCK_TTL_MS = 120_000;

const RELEASE_LOCK_IF_OWNER_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

const lockRedisKey = (disputeId: string) => `dispute-resolve:lock:${disputeId}`;

/**
 * Códigos de `svc-payments` que NO prueban que la plata no se movió (un pedido en curso, una captura que ya
 * falló y espera su reintento): la disputa queda `resolving` y se reintenta. Cualquier otro 4xx es un rechazo
 * seguro, antes de mover nada, y devuelve la disputa a `open`.
 */
const INDETERMINATE_PAYMENT_CODES = new Set([
  "REFUND_IN_PROGRESS",
  "REFUND_NEEDS_REVIEW",
  "SETTLEMENT_RETRY_PENDING",
  "SETTLEMENT_ESCALATED",
]);

export interface DisputeResolutionServiceDeps {
  shipmentRepository: ShipmentRepository;
  disputeRepository: DisputeRepository;
  paymentsClient: PaymentsClient;
  notificationsClient: NotificationsClient;
  alertNotifier: AlertNotifier;
  redis: Redis;
  logger: FastifyBaseLogger;
}

export interface DisputeResolutionService {
  resolve(
    disputeId: string,
    input: InternalResolveDisputeRequest,
  ): Promise<ResolveDisputeResponse>;
  /** Qué pasaría con cada resultado hoy: monto en juego, acción de pago, reparto y piso de la captura parcial. */
  preview(disputeId: string): Promise<AdminDisputeResolutionPreview>;
}

interface Plan {
  outcome: DisputeOutcome;
  percentage: number | null;
  carrierAmountArs: number;
  senderAmountArs: number;
  paymentAction: DisputePaymentAction;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** El pedido coincide con lo que la disputa ya tiene guardado (resultado, porcentaje o monto libre, razonamiento). */
function matchesStored(
  stored: DisputeResolutionRecord,
  input: InternalResolveDisputeRequest,
  reasoning: string,
): boolean {
  if (stored.outcome !== input.outcome || stored.reasoning !== reasoning)
    return false;
  if (input.outcome !== "partial")
    return input.percentage === undefined && input.amountArs === undefined;
  if (input.percentage !== undefined) {
    return (
      input.amountArs === undefined && stored.percentage === input.percentage
    );
  }
  return (
    input.amountArs !== undefined &&
    stored.percentage === null &&
    Math.abs(stored.carrierAmountArs - input.amountArs) < 0.005
  );
}

export function createDisputeResolutionService(
  deps: DisputeResolutionServiceDeps,
): DisputeResolutionService {
  const {
    shipmentRepository,
    disputeRepository,
    paymentsClient,
    redis,
    logger,
  } = deps;

  function validateInput(input: InternalResolveDisputeRequest): string {
    const reasoning = input.reasoning.trim();
    if (
      reasoning.length < DISPUTE_REASONING_MIN_LENGTH ||
      reasoning.length > DISPUTE_REASONING_MAX_LENGTH
    ) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        `El razonamiento tiene que tener entre ${DISPUTE_REASONING_MIN_LENGTH} y ${DISPUTE_REASONING_MAX_LENGTH} caracteres.`,
      );
    }
    if (input.outcome !== "partial") {
      if (input.percentage !== undefined || input.amountArs !== undefined) {
        throw new ApiError(
          400,
          "DISPUTE_PARTIAL_INVALID",
          "El porcentaje y el monto solo aplican a un resultado parcial.",
        );
      }
    } else if ((input.percentage === undefined) === (input.amountArs === undefined)) {
      throw new ApiError(
        400,
        "DISPUTE_PARTIAL_INVALID",
        "Un resultado parcial lleva un porcentaje del set predefinido o un monto libre, no ambos ni ninguno.",
        { presets: [...DISPUTE_PARTIAL_PRESETS] },
      );
    }
    return reasoning;
  }

  async function alert(
    kind: string,
    message: string,
    context: Record<string, string | number | boolean | null | undefined>,
  ): Promise<void> {
    await deps.alertNotifier
      .send({ kind, message, context })
      .catch((alertErr: unknown) => {
        logger.warn(
          { err: alertErr, event: "dispute_resolution_alert_failed", alert: kind },
          "No se pudo mandar la alerta",
        );
      });
  }

  interface Stake {
    statusAtOpen: DisputeResolvableStatus;
    stakeArs: number;
    /** Solo con el hold sin capturar (`in_transit`): fija el piso de una captura parcial. */
    applicationFeeArs: number | null;
  }

  /**
   * Lee el monto en juego con lo que hay HOY en `svc-payments` (hold autorizado o cobro acreditado). Es lo que
   * ve el panel antes de resolver y lo que usa la resolución, así no pueden diferir.
   */
  async function loadStake(shipment: Shipment): Promise<Stake> {
    if (shipment.status !== ShipmentStatus.DISPUTED) {
      throw new ApiError(
        409,
        "DISPUTE_NOT_OPEN",
        "El envío ya no está en disputa.",
        { currentStatus: shipment.status },
      );
    }
    const statusAtOpen = await disputeRepository.findStatusAtOpen(shipment.id);
    if (!statusAtOpen || !isDisputeResolvableStatus(statusAtOpen)) {
      throw new ApiError(
        422,
        "DISPUTE_NOT_ALLOWED",
        "No hay una forma de resolver una disputa abierta desde ese estado del envío.",
        { statusAtOpen },
      );
    }

    let stakeArs: number;
    let applicationFeeArs: number | null = null;
    switch (statusAtOpen) {
      case ShipmentStatus.ASSIGNED: {
        // No-retiro: el hold ya se liberó. Lo que está en juego es el neto del transportista (DD-056).
        if (shipment.agreedPriceArs === null || shipment.carrierId === null) {
          throw new ApiError(
            422,
            "DISPUTE_NOT_ALLOWED",
            "El envío no tiene un precio acordado ni un transportista.",
          );
        }
        stakeArs = computeNetFromGross(shipment.agreedPriceArs);
        break;
      }
      case ShipmentStatus.IN_TRANSIT: {
        const hold = await paymentsClient.findHoldByShipment(shipment.id);
        if (!hold || hold.status !== "authorized") {
          throw new ApiError(
            422,
            "HOLD_NOT_AUTHORIZED",
            "El hold del envío no está autorizado: no hay fondos retenidos para resolver.",
            { holdStatus: hold?.status ?? null },
          );
        }
        stakeArs = hold.amountArs;
        applicationFeeArs = hold.applicationFeeArs;
        break;
      }
      case ShipmentStatus.DELIVERED:
      case ShipmentStatus.COMPLETED: {
        const settlement = await paymentsClient.findSettlement(shipment.id);
        if (!settlement || settlement.status !== "credited") {
          throw new ApiError(
            422,
            "SETTLEMENT_NOT_REFUNDABLE",
            "El cobro del envío todavía no está acreditado: esperá a que se capture para resolver.",
            { settlementStatus: settlement?.status ?? null },
          );
        }
        const refunds = await paymentsClient.listRefunds(shipment.id);
        stakeArs = refunds?.refundableArs ?? settlement.grossAmountArs;
        break;
      }
      default:
        throw new ApiError(422, "DISPUTE_NOT_ALLOWED", "Estado de origen de la disputa no resoluble.", { statusAtOpen });
    }

    return {
      statusAtOpen: statusAtOpen as DisputeResolvableStatus,
      stakeArs,
      applicationFeeArs,
    };
  }

  /**
   * Decide el reparto y la acción de pago. Todo lo que se puede rechazar se rechaza acá, antes de guardar el
   * resultado.
   */
  async function buildPlan(
    shipment: Shipment,
    input: InternalResolveDisputeRequest,
  ): Promise<Plan> {
    const { statusAtOpen, stakeArs, applicationFeeArs } = await loadStake(shipment);
    const split = splitDisputeStake(stakeArs, input.outcome, {
      ...(input.percentage !== undefined && { percentage: input.percentage }),
      ...(input.amountArs !== undefined && { amountArs: input.amountArs }),
    });
    if ("error" in split) {
      if (split.error === "above_maximum") {
        throw new ApiError(
          422,
          "DISPUTE_PARTIAL_ABOVE_MAXIMUM",
          "El monto parcial tiene que ser menor al total en juego.",
          { maximumArs: round2(stakeArs - 0.01), stakeArs: round2(stakeArs) },
        );
      }
      throw new ApiError(
        400,
        "DISPUTE_PARTIAL_INVALID",
        "El porcentaje no es uno de los predefinidos o el monto no es válido.",
        { presets: [...DISPUTE_PARTIAL_PRESETS] },
      );
    }

    const paymentAction = disputePaymentAction(statusAtOpen, input.outcome);
    // AC6: la captura parcial no puede quedar por debajo de la comisión del hold (`svc-admin` ya lo validó antes
    // de llamar; esto cubre un hold que cambió en el medio).
    if (paymentAction === "capture_partial" && applicationFeeArs !== null) {
      const minimumArs = minimumPartialCaptureArs(applicationFeeArs);
      if (split.carrierAmountArs < minimumArs) {
        throw new ApiError(
          422,
          "DISPUTE_PARTIAL_BELOW_MINIMUM",
          "El monto parcial no cubre la comisión de Movo más la de Mercado Pago.",
          { minimumArs, holdAmountArs: round2(stakeArs) },
        );
      }
    }

    return {
      outcome: input.outcome,
      percentage: input.percentage ?? null,
      carrierAmountArs: split.carrierAmountArs,
      senderAmountArs: split.senderAmountArs,
      paymentAction,
    };
  }

  /**
   * La acción de pago de la matriz. Todo idempotente: reintentar tras un corte devuelve lo ya hecho en vez de
   * mover la plata de nuevo (hold: por envío; reembolso: `dispute-<id>`; crédito: `dispute-<id>-credit`).
   */
  async function executePayment(
    dispute: DisputeRecord,
    shipment: Shipment,
    plan: Plan,
    adminId: string,
    reasoning: string,
  ): Promise<{ refundFallback: boolean }> {
    switch (plan.paymentAction) {
      case "none":
        return { refundFallback: false };

      case "release_hold": {
        await paymentsClient.releaseHold(shipment.id);
        return { refundFallback: false };
      }

      case "capture_hold":
      case "capture_partial": {
        const settlement = await paymentsClient.captureHold(
          shipment.id,
          plan.paymentAction === "capture_partial"
            ? { kind: "cancellation_penalty", amountArs: plan.carrierAmountArs }
            : undefined,
        );
        if (settlement.status !== "credited") {
          throw new ApiError(
            502,
            "DISPUTE_PAYMENT_FAILED",
            "La captura todavía no está acreditada.",
            { settlementStatus: settlement.status },
          );
        }
        return { refundFallback: false };
      }

      case "refund_full":
      case "refund_partial": {
        const { refund } = await paymentsClient.createRefund(shipment.id, {
          ...(plan.paymentAction === "refund_partial" && {
            amountArs: plan.senderAmountArs,
          }),
          reason: reasoning.slice(0, 500),
          idempotencyKey: `dispute-${dispute.id}`,
          adminId,
        });
        if (refund.status === "succeeded") return { refundFallback: false };
        if (refund.status === "fallback_to_ledger") {
          // El transportista no tenía saldo en MP: su deuda quedó en la cuenta corriente y el emisor todavía no
          // cobró. La plata está "movida" (no se reintenta contra MP) pero devolvérsela es un caso manual.
          return { refundFallback: true };
        }
        throw new ApiError(
          502,
          "DISPUTE_PAYMENT_FAILED",
          "El reembolso no se pudo confirmar.",
          {
            refundStatus: refund.status,
            refundFailureReason: refund.failureReason,
          },
        );
      }

      case "ledger_credit": {
        if (!shipment.carrierId) {
          throw new ApiError(
            422,
            "DISPUTE_NOT_ALLOWED",
            "El envío no tiene transportista al que acreditar.",
          );
        }
        await paymentsClient.createManualAdjustment(shipment.carrierId, {
          idempotencyKey: `dispute-${dispute.id}-credit`,
          amountArs: -plan.carrierAmountArs,
          reason: `Disputa ${dispute.id.slice(0, 8)}: compensación al transportista. ${reasoning}`.slice(0, 500),
          adminId,
          shipmentId: shipment.id,
        });
        return { refundFallback: false };
      }
    }
  }

  function responseOf(
    dispute: DisputeRecord,
    resolution: DisputeResolutionRecord,
    replayed: boolean,
    resolvedAt: Date,
  ): ResolveDisputeResponse {
    return {
      disputeId: dispute.id,
      shipmentId: dispute.shipmentId,
      outcome: resolution.outcome,
      reasoning: resolution.reasoning,
      carrierAmountArs: resolution.carrierAmountArs,
      senderAmountArs: resolution.senderAmountArs,
      paymentAction: resolution.paymentAction,
      status: DisputeStatus.RESOLVED,
      shipmentStatus: disputeFinalShipmentStatus(resolution.outcome),
      replayed,
      resolvedAt: resolvedAt.toISOString(),
    };
  }

  /** Push a las tres partes (AC11): sin montos; el razonamiento viaja en `data`. Nunca lanza. */
  async function notifyParties(
    dispute: DisputeRecord,
    shipment: Shipment,
    resolution: DisputeResolutionRecord,
  ): Promise<void> {
    const winners = disputeRatingWinners(resolution.outcome);
    const targets: Array<{ userId: string | null; role: DisputePartyRole }> = [
      { userId: shipment.senderId, role: "sender" },
      { userId: shipment.receiverId, role: "receiver" },
      { userId: shipment.carrierId, role: "carrier" },
    ];
    const notified = new Set<string>();
    await Promise.all(
      targets.map(async ({ userId, role }) => {
        // Una persona con dos roles (emisor y receptor) recibe un solo aviso, con el resultado de su rol de parte.
        if (!userId || notified.has(userId)) return;
        notified.add(userId);
        const isWinner = winners.includes(role);
        const result =
          role === "receiver"
            ? "neutral"
            : resolution.outcome === "partial"
              ? "partial"
              : isWinner
                ? "favorable"
                : "unfavorable";
        try {
          const { title, body } = renderNotificationTrigger("disputeResolved", {
            result,
            ratingPending: isWinner,
          });
          await deps.notificationsClient.sendPush({
            userId,
            title,
            body,
            category: notificationTriggerCategory("disputeResolved"),
            data: {
              type: "dispute_resolved",
              disputeId: dispute.id,
              shipmentId: shipment.id,
              outcome: resolution.outcome,
              result,
              reasoning: resolution.reasoning,
              ratingPending: isWinner,
            },
          });
        } catch (err) {
          logger.warn(
            {
              err,
              event: "notification_dispatch_failed",
              shipmentId: shipment.id,
              disputeId: dispute.id,
              userId,
            },
            "No se pudo enviar la push de disputa resuelta",
          );
        }
      }),
    );
  }

  return {
    async preview(disputeId) {
      const dispute = await disputeRepository.findById(disputeId);
      if (!dispute) {
        throw new ApiError(404, "DISPUTE_NOT_FOUND", "Disputa no encontrada.");
      }
      if (dispute.status === DisputeStatus.RESOLVED) {
        throw new ApiError(409, "DISPUTE_NOT_OPEN", "La disputa ya está resuelta.");
      }
      const shipment = await shipmentRepository.findById(dispute.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      const { statusAtOpen, stakeArs, applicationFeeArs } = await loadStake(shipment);
      const minimumPartialArs =
        statusAtOpen === "in_transit" && applicationFeeArs !== null
          ? minimumPartialCaptureArs(applicationFeeArs)
          : null;
      const splitOf = (outcome: DisputeOutcome, percentage?: number) => {
        const split = splitDisputeStake(stakeArs, outcome, percentage === undefined ? {} : { percentage });
        return "error" in split ? null : split;
      };
      return {
        statusAtOpen,
        stakeArs: round2(stakeArs),
        minimumPartialArs,
        outcomes: (["sender", "carrier", "partial"] as const).map((outcome) => ({
          outcome,
          paymentAction: disputePaymentAction(statusAtOpen, outcome),
          shipmentStatus: disputeFinalShipmentStatus(outcome),
        })),
        presets: DISPUTE_PARTIAL_PRESETS.flatMap((percentage) => {
          const split = splitOf("partial", percentage);
          return split
            ? [
                {
                  percentage,
                  carrierAmountArs: split.carrierAmountArs,
                  senderAmountArs: split.senderAmountArs,
                  belowMinimum: minimumPartialArs !== null && split.carrierAmountArs < minimumPartialArs,
                },
              ]
            : [];
        }),
      };
    },

    async resolve(disputeId, input) {
      const reasoning = validateInput(input);

      const lockKey = lockRedisKey(disputeId);
      const token = randomUUID();
      const locked = await redis.set(lockKey, token, "PX", LOCK_TTL_MS, "NX");
      if (locked !== "OK") {
        throw new ApiError(
          409,
          "DISPUTE_RESOLUTION_IN_PROGRESS",
          "Esta disputa se está resolviendo en este momento.",
        );
      }

      try {
        const dispute = await disputeRepository.findById(disputeId);
        if (!dispute) {
          throw new ApiError(404, "DISPUTE_NOT_FOUND", "Disputa no encontrada.");
        }
        const shipment = await shipmentRepository.findById(dispute.shipmentId);
        if (!shipment) {
          throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
        }

        // Ya resuelta o con resultado guardado: el pedido tiene que ser el mismo.
        let resolution = dispute.resolution;
        if (dispute.status !== DisputeStatus.OPEN) {
          if (!resolution || !matchesStored(resolution, input, reasoning)) {
            throw new ApiError(
              409,
              "DISPUTE_RESOLUTION_MISMATCH",
              dispute.status === DisputeStatus.RESOLVED
                ? "La disputa ya está resuelta con otro resultado."
                : "La disputa ya tiene un resultado guardado con otros datos: reintentá con los mismos.",
            );
          }
          if (dispute.status === DisputeStatus.RESOLVED) {
            return responseOf(
              dispute,
              resolution,
              true,
              resolution.resolvedAt ?? new Date(),
            );
          }
        }

        let plan: Plan;
        if (resolution) {
          plan = {
            outcome: resolution.outcome,
            percentage: resolution.percentage,
            carrierAmountArs: resolution.carrierAmountArs,
            senderAmountArs: resolution.senderAmountArs,
            paymentAction: resolution.paymentAction,
          };
        } else {
          plan = await buildPlan(shipment, input);
          const begun = await disputeRepository.beginResolution({
            disputeId,
            outcome: plan.outcome,
            percentage: plan.percentage,
            carrierAmountArs: plan.carrierAmountArs,
            senderAmountArs: plan.senderAmountArs,
            paymentAction: plan.paymentAction,
            reasoning,
            resolvedBy: input.adminId,
          });
          if (!begun) {
            throw new ApiError(404, "DISPUTE_NOT_FOUND", "Disputa no encontrada.");
          }
          resolution = begun.dispute.resolution;
          if (begun.state !== "started") {
            // Otra instancia la resolvió entre la lectura y el `FOR UPDATE`: se compara con lo guardado.
            if (!resolution || !matchesStored(resolution, input, reasoning)) {
              throw new ApiError(
                409,
                "DISPUTE_RESOLUTION_MISMATCH",
                "La disputa ya se resolvió con otros datos.",
              );
            }
            if (begun.state === "already_resolved") {
              return responseOf(
                begun.dispute,
                resolution,
                true,
                resolution.resolvedAt ?? new Date(),
              );
            }
          }
        }
        if (!resolution) {
          throw new Error("Disputa en resolución sin resultado guardado");
        }

        // La acción de pago. Si falla, la disputa NO queda resuelta (AC7).
        let refundFallback = false;
        try {
          ({ refundFallback } = await executePayment(
            dispute,
            shipment,
            plan,
            input.adminId,
            reasoning,
          ));
        } catch (err) {
          const definitive =
            err instanceof ApiError &&
            err.statusCode >= 400 &&
            err.statusCode < 500 &&
            err.statusCode !== 408 &&
            err.statusCode !== 429 &&
            !INDETERMINATE_PAYMENT_CODES.has(err.code);
          if (definitive) {
            // Rechazo de negocio antes de mover nada: el admin puede resolver de nuevo con otros datos.
            await disputeRepository.abortResolution(disputeId);
            throw err;
          }
          logger.error(
            {
              err,
              event: "dispute_payment_failed",
              disputeId,
              shipmentId: shipment.id,
              paymentAction: plan.paymentAction,
            },
            "Falló la acción de pago de la resolución de una disputa",
          );
          await alert(
            "dispute_payment_failed",
            "Falló la acción de pago de una disputa resuelta: queda en revisión y se puede reintentar",
            {
              disputeId,
              shipmentId: shipment.id,
              paymentAction: plan.paymentAction,
              adminId: input.adminId,
              errorCode: err instanceof ApiError ? err.code : "INTERNAL_ERROR",
            },
          );
          if (err instanceof ApiError && err.code === "DISPUTE_PAYMENT_FAILED") {
            throw err;
          }
          throw new ApiError(
            502,
            "DISPUTE_PAYMENT_FAILED",
            "No se pudo confirmar el movimiento de dinero. La disputa quedó en revisión: reintentá con los mismos datos.",
            {
              disputeId,
              cause: err instanceof ApiError ? err.code : "INTERNAL_ERROR",
            },
          );
        }

        if (refundFallback) {
          await alert(
            "dispute_refund_fallback_to_ledger",
            "Una disputa se resolvió a favor del emisor pero el reembolso quedó en la cuenta corriente del transportista: hay que devolverle la plata al emisor a mano",
            {
              disputeId,
              shipmentId: shipment.id,
              senderAmountArs: plan.senderAmountArs,
            },
          );
        }

        // Estado final del envío y disputa `resolved`, en una sola transacción.
        const finalStatus =
          disputeFinalShipmentStatus(plan.outcome) === "cancelled"
            ? ShipmentStatus.CANCELLED
            : ShipmentStatus.COMPLETED;
        const outcomeLabel =
          plan.outcome === "sender"
            ? "a favor del emisor"
            : plan.outcome === "carrier"
              ? "a favor del transportista"
              : "con un resultado parcial";
        try {
          await shipmentRepository.updateStatus(
            shipment.id,
            finalStatus,
            input.adminId,
            `Disputa resuelta ${outcomeLabel}`,
            {
              expectedFrom: ShipmentStatus.DISPUTED,
              resolveDispute: { id: disputeId },
              adminActor: { kind: "manual", name: input.adminName },
            },
          );
        } catch (err) {
          if (
            err instanceof ShipmentConcurrentModificationError ||
            err instanceof InvalidShipmentTransitionError
          ) {
            // ¿La cerró otra llamada mientras tanto? Si quedó resuelta con lo mismo, es un reintento.
            const current = await disputeRepository.findById(disputeId);
            if (
              current?.status === DisputeStatus.RESOLVED &&
              current.resolution &&
              matchesStored(current.resolution, input, reasoning)
            ) {
              return responseOf(
                current,
                current.resolution,
                true,
                current.resolution.resolvedAt ?? new Date(),
              );
            }
          }
          logger.error(
            { err, event: "dispute_finalize_failed", disputeId, shipmentId: shipment.id },
            "La plata de la disputa se movió pero no se pudo cerrar el envío",
          );
          await alert(
            "dispute_finalize_failed",
            "La acción de pago de una disputa se hizo, pero no se pudo cerrar el envío: reintentar la resolución con los mismos datos",
            { disputeId, shipmentId: shipment.id, adminId: input.adminId },
          );
          throw new ApiError(
            502,
            "DISPUTE_PAYMENT_FAILED",
            "El movimiento de dinero se hizo pero no se pudo cerrar la disputa. Reintentá con los mismos datos.",
            { disputeId, cause: "finalize_failed" },
          );
        }

        const resolved = await disputeRepository.findById(disputeId);
        const finalResolution = resolved?.resolution ?? resolution;
        logger.warn(
          {
            event: "dispute_resolved",
            disputeId,
            shipmentId: shipment.id,
            outcome: plan.outcome,
            paymentAction: plan.paymentAction,
            adminId: input.adminId,
            reason: dispute.reason === DisputeReason.PICKUP_NO_SHOW ? "pickup_no_show" : dispute.reason,
          },
          "Un admin resolvió una disputa",
        );
        await notifyParties(dispute, shipment, finalResolution);
        return responseOf(
          dispute,
          finalResolution,
          false,
          finalResolution.resolvedAt ?? new Date(),
        );
      } finally {
        await redis
          .eval(RELEASE_LOCK_IF_OWNER_SCRIPT, 1, lockKey, token)
          .catch((err: unknown) => {
            logger.warn(
              { err, event: "dispute_resolve_lock_release_failed", disputeId },
              "No se pudo liberar el lock",
            );
          });
      }
    },
  };
}
