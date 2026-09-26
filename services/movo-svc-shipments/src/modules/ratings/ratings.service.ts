import {
  ApiError,
  ShipmentStatus,
  UserRole,
  renderNotificationTrigger,
  notificationTriggerCategory,
  CARRIER_RATING_CATEGORIES,
  SENDER_RATING_CATEGORIES,
  RECEIVER_RATING_CATEGORIES,
  RatingCategoryScoreField,
  ReputationCategoryScore,
} from "@movo/shared";
import { FastifyBaseLogger } from "fastify";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { RatingRepository } from "../../repositories/rating-repository";
import { NotificationsClient } from "../../adapters/notifications-client";
import { Shipment, ShipmentEvent } from "../../models/shipment";
import { Rating, RatingCategoryScoresInput, RatingRole } from "../../models/rating";
import { isRatingWindowOpen } from "../../domain/rating-window";
import { computeCategoryScores, computeReputationScore, ReputationResult } from "../../domain/reputation";
import { FULFILLED_SHIPMENT_STATUSES } from "../../domain/shipment-state-machine";

export interface CreateRatingServiceInput extends RatingCategoryScoresInput {
  shipmentId: string;
  raterId: string;
  rateeId: string;
  score: number;
  comment?: string;
}

export interface UpdateRatingServiceInput extends RatingCategoryScoresInput {
  shipmentId: string;
  raterId: string;
  rateeId: string;
  score: number;
  comment?: string;
}

/** MOVO-147: `C`/semivida del score de reputación -- ver `domain/reputation.ts`. */
export interface ReputationServiceConfig {
  confidenceConstant: number;
  decayHalfLifeDays: number;
}

/** Mismos valores que el default de `envSchema` (`config/env.ts`) -- red de
 * seguridad para callers que no inyectan `reputationConfig` explícito (tests, y
 * cualquier construcción de `createRatingsService` que no pase por
 * `ratings.routes.ts`), nunca una segunda fuente de verdad para el valor real. */
const DEFAULT_REPUTATION_CONFIG: ReputationServiceConfig = {
  confidenceConstant: 5,
  decayHalfLifeDays: 180,
};

/** MOVO-170: subconjunto de estadísticas de uso calculable con datos ya persistidos,
 * agregado por rol (ver `shipment-repository.ts#getUsageStatsByRole`). */
export interface UsageStats {
  delivered: number;
  cancelled: number;
  avgPackageWeightKg: number | null;
}

/** MOVO-173: `categories` ausente (no `[]`) si ninguna categoría del rol tiene datos. */
type RoleReputation = ReputationResult & { usageStats: UsageStats; categories?: ReputationCategoryScore[] };

export interface ReputationSummary extends ReputationResult {
  asSender: RoleReputation;
  asCarrier: RoleReputation;
  transactionCounts: { asSender: number; asCarrier: number };
}

type ServiceLogger =
  | FastifyBaseLogger
  | { warn: (obj: unknown, msg?: string) => void };

/** AC1: rol del usuario dentro de ESTE envío en particular. `null` si no es ninguna de
 * las tres partes -- el caller decide qué `ApiError` corresponde. */
function resolveShipmentRole(shipment: Shipment, userId: string): RatingRole | null {
  if (userId === shipment.senderId) {
    return RatingRole.sender;
  }
  if (shipment.carrierId && userId === shipment.carrierId) {
    return RatingRole.carrier;
  }
  if (userId === shipment.receiverId) {
    return RatingRole.receiver;
  }
  return null;
}

/**
 * MOVO-173: qué sub-scores admite calificar a alguien según su rol EN ESTE ENVÍO. El
 * emisor y el receptor comparten set (puntualidad/comunicación). Mandar una categoría
 * de otro rol (ej. `careScore` a un emisor) es un error del cliente, no algo que se ignore
 * en silencio: quedaría guardado un dato que nunca se va a agregar.
 */
const CATEGORY_FIELDS_BY_RATEE_ROLE: Record<RatingRole, ReadonlySet<RatingCategoryScoreField>> = {
  [RatingRole.carrier]: new Set(CARRIER_RATING_CATEGORIES.map((c) => c.scoreField)),
  [RatingRole.sender]: new Set(SENDER_RATING_CATEGORIES.map((c) => c.scoreField)),
  [RatingRole.receiver]: new Set(RECEIVER_RATING_CATEGORIES.map((c) => c.scoreField)),
};

const ALL_CATEGORY_FIELDS: readonly RatingCategoryScoreField[] = [
  "punctualityScore",
  "careScore",
  "communicationScore",
];

const RATEE_ROLE_LABEL: Record<RatingRole, string> = {
  [RatingRole.carrier]: "transportista",
  [RatingRole.sender]: "emisor",
  [RatingRole.receiver]: "receptor",
};

/** Solo los sub-scores que vinieron en el input (el resto de sus campos no son categorías). */
function pickCategoryScores(input: RatingCategoryScoresInput): RatingCategoryScoresInput {
  const picked: RatingCategoryScoresInput = {};
  for (const field of ALL_CATEGORY_FIELDS) {
    if (input[field] !== undefined) {
      picked[field] = input[field];
    }
  }
  return picked;
}

function assertCategoriesMatchRateeRole(rateeRole: RatingRole, categories: RatingCategoryScoresInput): void {
  const allowed = CATEGORY_FIELDS_BY_RATEE_ROLE[rateeRole];
  const invalid = ALL_CATEGORY_FIELDS.filter((field) => categories[field] !== undefined && !allowed.has(field));
  if (invalid.length > 0) {
    throw new ApiError(
      422,
      "VALIDATION_FAILED",
      `Las categorías ${invalid.join(", ")} no aplican al calificar a un ${RATEE_ROLE_LABEL[rateeRole]}.`,
    );
  }
}

function assertIsShipmentParty(shipment: Shipment, userId: string, message: string): void {
  if (resolveShipmentRole(shipment, userId) === null) {
    throw new ApiError(403, "AUTH_FORBIDDEN", message);
  }
}

/** AC6: a diferencia de alta/edición (solo partes), la lectura también habilita a un
 * admin -- mismo criterio que `assertShipmentAccess` para el resto de los sub-recursos
 * de un envío (fotos, eventos). */
function assertCanViewRatings(shipment: Shipment, callerId: string, callerRoles: UserRole[]): void {
  const isParty = resolveShipmentRole(shipment, callerId) !== null;
  const isAdmin = callerRoles.includes(UserRole.ADMIN);
  if (!isParty && !isAdmin) {
    throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver las calificaciones de este envío.");
  }
}

/**
 * AC3/AC8/AC9: precondiciones de estado compartidas por alta y edición. Nunca deja
 * pasar un 500 -- todo incumplimiento resuelve a un `ApiError` explícito (AC3).
 */
function assertRatingWindowAllowsWrite(shipment: Shipment, events: ShipmentEvent[], now: Date): void {
  if (shipment.status === ShipmentStatus.DISPUTED) {
    throw new ApiError(
      409,
      "SHIPMENT_RATING_DISPUTE_ACTIVE",
      "El envío tiene una disputa activa -- no se puede calificar hasta que se resuelva.",
    );
  }
  // MOVO-208: `completed` (entregado Y pago liberado) también puede calificarse -- es
  // una consecuencia posterior de `delivered`, no un estado que deba cerrar la ventana
  // de calificación. `deliveredAt` sigue siendo la referencia real de la ventana de
  // 72h en los dos casos: no se toca al pasar a `completed` (MOVO-212).
  if (!FULFILLED_SHIPMENT_STATUSES.includes(shipment.status) || !shipment.deliveredAt) {
    throw new ApiError(409, "SHIPMENT_NOT_DELIVERED", "El envío todavía no fue entregado.");
  }
  if (!isRatingWindowOpen(shipment.deliveredAt, events, now)) {
    throw new ApiError(
      409,
      "SHIPMENT_RATING_WINDOW_EXPIRED",
      "El plazo de 72 horas para calificar este envío ya venció.",
    );
  }
}

export function createRatingsService(
  shipmentRepository: ShipmentRepository,
  ratingRepository: RatingRepository,
  notificationsClient?: NotificationsClient,
  logger?: ServiceLogger,
  reputationConfig: ReputationServiceConfig = DEFAULT_REPUTATION_CONFIG,
) {
  return {
    async createRating(input: CreateRatingServiceInput): Promise<Rating> {
      const shipment = await shipmentRepository.findById(input.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      // AC3: calificador y calificado tienen que ser partes de este envío, y nadie se
      // califica a sí mismo -- verificado antes de tocar el estado/ventana.
      assertIsShipmentParty(shipment, input.raterId, "No participaste de este envío.");
      const rateeRole = resolveShipmentRole(shipment, input.rateeId);
      if (rateeRole === null) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "El usuario a calificar no participó de este envío.");
      }
      if (input.raterId === input.rateeId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No podés calificarte a vos mismo.");
      }
      assertCategoriesMatchRateeRole(rateeRole, input);

      const events = await shipmentRepository.listEvents(input.shipmentId);
      assertRatingWindowAllowsWrite(shipment, events, new Date());

      // AC5/AC2: un POST repetido sobre el mismo par choca con el constraint único de
      // base -- `ratingRepository.create` lo traduce a `DuplicateRatingError`, mapeado
      // a 409 SHIPMENT_RATING_ALREADY_EXISTS en `plugins/error-handler.ts`.
      const created = await ratingRepository.create({
        shipmentId: input.shipmentId,
        raterId: input.raterId,
        rateeId: input.rateeId,
        role: rateeRole,
        score: input.score,
        comment: input.comment,
        ...pickCategoryScores(input),
      });

      // AC7: best-effort, fire-and-forget -- un fallo de entrega no revierte el alta
      // ya commiteada (mismo criterio que dispatchReceiverDecisionPush en
      // shipments.service.ts).
      if (notificationsClient) {
        const { title, body } = renderNotificationTrigger("ratingReceived", undefined);
        void notificationsClient
          .sendPush({
            userId: created.rateeId,
            title,
            body,
            category: notificationTriggerCategory("ratingReceived"),
            data: { type: "rating_received", shipmentId: created.shipmentId },
          })
          .catch((err: unknown) => {
            logger?.warn(
              { err, event: "notification_dispatch_failed", shipmentId: created.shipmentId },
              "No se pudo notificar la calificación recibida",
            );
          });
      }

      return created;
    },

    async updateRating(input: UpdateRatingServiceInput): Promise<Rating> {
      const shipment = await shipmentRepository.findById(input.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      const existing = await ratingRepository.findByPair(input.shipmentId, input.raterId, input.rateeId);
      if (!existing) {
        throw new ApiError(404, "SHIPMENT_RATING_NOT_FOUND", "No existe una calificación tuya para editar.");
      }
      // `existing.role` es el rol del CALIFICADO, fijado al crear la calificación.
      assertCategoriesMatchRateeRole(existing.role, input);

      const events = await shipmentRepository.listEvents(input.shipmentId);
      assertRatingWindowAllowsWrite(shipment, events, new Date());

      return ratingRepository.update(
        input.shipmentId,
        input.raterId,
        input.rateeId,
        input.score,
        input.comment,
        pickCategoryScores(input),
      );
    },

    async listShipmentRatings(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<Rating[]> {
      const shipment = await shipmentRepository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }
      assertCanViewRatings(shipment, callerId, callerRoles);
      return ratingRepository.listByShipment(shipmentId);
    },

    /**
     * AC10: consumido por el endpoint interno que lee `movo-svc-users`. MOVO-170 lo
     * paginó (`cursor` opcional) -- sin cursor es la primera página, mismo
     * comportamiento que antes de esta US para la composición del perfil (límite 10).
     * También sirve a `GET /users/:id/ratings` ("ver todas las calificaciones",
     * MOVO-176) pidiendo páginas siguientes con el `nextCursor` de la anterior.
     */
    async listRecentRatingsForUser(
      userId: string,
      limit: number,
      cursor?: string,
    ): Promise<{ items: Rating[]; nextCursor: string | null }> {
      return ratingRepository.listRecentByRateePaginated(userId, limit, cursor);
    },

    /**
     * MOVO-147 AC3: agregado ponderado de reputación de `userId` -- consumido hoy por
     * `GET /internal/users/:id/reputation` (`ratings.routes.ts`) y pensado para que
     * MOVO-23 (creación de oferta, todavía sin implementar) lo llame LOCALMENTE
     * (mismo servicio, misma DB) al snapshotear `carrierRatingAtOffer` -- AC5, sin
     * HTTP contra sí mismo.
     */
    async getReputationSummary(userId: string): Promise<ReputationSummary> {
      const [ratings, transactionCounts, usageStatsByRole] = await Promise.all([
        ratingRepository.listForReputation(userId),
        shipmentRepository.countCompletedTransactions(userId),
        shipmentRepository.getUsageStatsByRole(userId),
      ]);

      // AC6: `m` sale de un único agregado SQL (`AVG` sobre TODA la tabla `ratings`,
      // ver rating-repository.ts) -- distinto de `ratings` de arriba, acotado a este
      // `userId`. Se salta la query si esta persona no tiene ninguna calificación
      // propia (nada que shrinkear hacia `m` en ese caso).
      const globalAverageScore = ratings.length > 0 ? await ratingRepository.getGlobalAverageScore() : 0;

      const params = {
        confidenceConstant: reputationConfig.confidenceConstant,
        decayHalfLifeDays: reputationConfig.decayHalfLifeDays,
        globalAverageScore,
      };

      // AC3: "asSender"/"asCarrier" son el MISMO cálculo (`computeReputationScore`,
      // AC1) restringido a las calificaciones recibidas en ese rol -- `role` acá es el
      // rol del CALIFICADO en cada envío puntual (models/rating.ts), no un rol de
      // cuenta. Las calificaciones como `receiver` entran al global pero no tienen
      // desglose propio -- AC3 solo pide sender/carrier porque es la reputación de
      // transportista la que importa al elegir una oferta (MOVO-17/23).
      const global = computeReputationScore(ratings, params);
      const senderRatings = ratings.filter((r) => r.role === RatingRole.sender);
      const carrierRatings = ratings.filter((r) => r.role === RatingRole.carrier);
      const asSender = computeReputationScore(senderRatings, params);
      const asCarrier = computeReputationScore(carrierRatings, params);

      // MOVO-173: las categorías dependen del rol, así que solo existen en el desglose
      // por rol -- el global mezclaría "Cuidado del paquete" (solo del transportista) con las de las contrapartes.
      const senderCategories = computeCategoryScores(senderRatings, SENDER_RATING_CATEGORIES, params);
      const carrierCategories = computeCategoryScores(carrierRatings, CARRIER_RATING_CATEGORIES, params);

      return {
        ...global,
        asSender: {
          ...asSender,
          usageStats: { delivered: transactionCounts.asSender, ...usageStatsByRole.asSender },
          ...(senderCategories && { categories: senderCategories }),
        },
        asCarrier: {
          ...asCarrier,
          usageStats: { delivered: transactionCounts.asCarrier, ...usageStatsByRole.asCarrier },
          ...(carrierCategories && { categories: carrierCategories }),
        },
        transactionCounts,
      };
    },

    /**
     * MOVO-188: variante batch de `getReputationSummary` acotada al score `asCarrier`
     * -- para desempatar `competitiveRank` (`offers.service.ts#listMyOffers`) entre
     * varios transportistas que ofertaron el mismo precio en el mismo envío, sin
     * llamar a `getReputationSummary` una vez por competidor (reintroduciría el N+1
     * que el resto de MOVO-188 evita). Dos queries en total sin importar cuántos
     * `carrierId` se pidan: `listForReputationByRateeIds` (batch) +
     * `getGlobalAverageScore` (un único `AVG`, se reusa igual para todos -- es la
     * media de TODA la plataforma en este instante, no depende del carrier).
     */
    async getCarrierReputationScoresBatch(carrierIds: string[]): Promise<Map<string, number | null>> {
      const result = new Map<string, number | null>();
      if (carrierIds.length === 0) {
        return result;
      }
      const [ratingsByCarrier, globalAverageScore] = await Promise.all([
        ratingRepository.listForReputationByRateeIds(carrierIds),
        ratingRepository.getGlobalAverageScore(),
      ]);
      const params = {
        confidenceConstant: reputationConfig.confidenceConstant,
        decayHalfLifeDays: reputationConfig.decayHalfLifeDays,
        globalAverageScore,
      };
      for (const carrierId of carrierIds) {
        const asCarrierRatings = (ratingsByCarrier.get(carrierId) ?? []).filter((r) => r.role === RatingRole.carrier);
        result.set(carrierId, computeReputationScore(asCarrierRatings, params).reputationScore);
      }
      return result;
    },
  };
}
