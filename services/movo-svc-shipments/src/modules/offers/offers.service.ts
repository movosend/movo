import {
  ApiError,
  OfferStatus,
  ShipmentStatus,
  computeNetFromGross,
  computeOfferGrossPrice,
  getCommissionConfig,
} from "@movo/shared";
import { FastifyBaseLogger } from "fastify";
import { OfferRepository } from "../../repositories/offer-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { NotificationsClient } from "../../adapters/notifications-client";
import { UsersClient } from "../../adapters/users-client";
import { Offer, OfferCompetitiveRank, OfferWithShipmentContext } from "../../models/offer";
import { Trip } from "../../models/trip";
import { assertIsSender } from "../shipments/assert-shipment-access";
// MOVO-181: reusa las mismas conversiones de fecha/hora que `createOfferForShipment`
// (MOVO-143/177) en vez de duplicarlas -- ver el comentario de export en
// shipments.service.ts.
import { anchorDateUtc, combineDateAndTime, normalizeTime, toEpochTime } from "../shipments/shipments.service";
import { pickupWindowEndInstant } from "../../domain/pickup-window";

/**
 * MOVO-181 (AC1/AC3): subset editable vía `PATCH /offers/:id`, tal como llega del
 * body HTTP -- `offeredDate`/las dos franjas son strings sin parsear todavía (mismo
 * shape que `CreateOfferForShipmentInput` en shipments.service.ts), no el
 * `UpdateOfferInput` del repositorio (que ya espera `Date`/valores normalizados). Cada
 * campo ausente (`undefined`) significa "no tocar" -- semántica de PATCH parcial.
 */
export interface PatchOfferInput {
  priceOfferedArs?: number;
  offeredDate?: string;
  // `null` es un valor válido acá (no solo ausente): resetea la franja propuesta a
  // "usa la ventana del envío tal cual" (`UpdateOfferInput`, models/offer.ts).
  offeredPickupTimeWindowStart?: string | null;
  offeredPickupTimeWindowEnd?: string | null;
}

/** MOVO-188: batch de reputación `asCarrier` (`ratings.service.ts#getCarrierReputationScoresBatch`)
 * inyectado por `offers.routes.ts` -- mismo criterio de callback local (sin HTTP contra
 * sí mismo) que `ShipmentsServiceOptions.getCarrierReputationScore` (MOVO-143), pero en
 * versión batch: acá se necesita el score de TODOS los carriers que compiten en la
 * página a la vez, no de uno solo. */
export type GetCarrierReputationScores = (carrierIds: string[]) => Promise<Map<string, number | null>>;

interface CompetingOffer {
  id: string;
  carrierId: string;
  priceOffered: number;
  createdAt: Date;
}

type OffersServiceLogger =
  | FastifyBaseLogger
  | { info?: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };

interface OfferPushParams {
  carrierId: string;
  title: string;
  body: string;
  shipmentId: string;
  offerId: string;
  type: "offer_accepted" | "offer_superseded" | "offer_rejected";
}

async function dispatchOfferPush(
  notificationsClient: NotificationsClient | undefined,
  logger: OffersServiceLogger | undefined,
  params: OfferPushParams
): Promise<void> {
  if (!notificationsClient) {
    return;
  }
  try {
    await notificationsClient.sendPush({
      userId: params.carrierId,
      title: params.title,
      body: params.body,
      data: { type: params.type, shipmentId: params.shipmentId, offerId: params.offerId },
    });
  } catch (err) {
    logger?.warn(
      { err, event: "notification_dispatch_failed", shipmentId: params.shipmentId, offerId: params.offerId },
      "No se pudo enviar la push de decisión de oferta"
    );
  }
}

/** MOVO-234 (AC1): fallback cuando el transportista no tiene ficha de vehículo cargada
 * (`PublicProfile.vehicle`, MOVO-172) o `usersClient` falla al resolverla -- mismo
 * criterio de placeholder neutro que `UNKNOWN_COUNTERPARTY_NAME`
 * (`shipments.service.ts`). */
const AUTO_TRIP_VEHICLE_TYPE_PLACEHOLDER = "Vehículo sin especificar";

/**
 * MOVO-234 (AC1): `vehicleType` del `Trip` auto-creado al aceptar una oferta sin
 * viaje asociado -- mismo formato `${brand} ${model}` que usa `movo-mobile` al
 * declarar un viaje a mano (`components/trips/trip-form.tsx`). Best-effort: sin
 * `usersClient` inyectado, sin ficha de vehículo cargada, o ante cualquier fallo de
 * red, degrada al placeholder -- nunca bloquea la aceptación de la oferta (mismo
 * criterio try/catch+`logger?.warn` que `resolveSnapshotProfile`,
 * `shipments.service.ts`).
 */
async function resolveAutoTripVehicleType(
  usersClient: UsersClient | undefined,
  carrierId: string,
  logger?: OffersServiceLogger
): Promise<string> {
  if (!usersClient) {
    return AUTO_TRIP_VEHICLE_TYPE_PLACEHOLDER;
  }
  try {
    const profile = await usersClient.findPublicProfile(carrierId, carrierId);
    if (profile?.vehicle) {
      return `${profile.vehicle.brand} ${profile.vehicle.model}`;
    }
  } catch (err) {
    logger?.warn(
      { err, event: "auto_trip_vehicle_lookup_failed", carrierId },
      "No se pudo resolver la ficha de vehículo del transportista para el viaje auto-creado"
    );
  }
  return AUTO_TRIP_VEHICLE_TYPE_PLACEHOLDER;
}

/** MOVO-234 (AC3): aviso explícito al transportista de que se creó un viaje a partir
 * de este envío -- "no un efecto silencioso" (letra del AC). Mismo patrón
 * try/catch+`logger?.warn` que `dispatchOfferPush`; el copy/canal final (push vs.
 * in-app) es de `movo-mobile` (MOVO-236, bloqueado por este ticket), acá solo se
 * dispara el trigger de backend vía `notificationsClient.sendPush`. */
async function dispatchAutoTripCreatedPush(
  notificationsClient: NotificationsClient | undefined,
  logger: OffersServiceLogger | undefined,
  trip: Trip
): Promise<void> {
  if (!notificationsClient) {
    return;
  }
  try {
    await notificationsClient.sendPush({
      userId: trip.carrierId,
      title: "Se creó un viaje a partir de este envío",
      body: "Armamos un viaje en tu cuenta con este envío -- vas a recibir avisos de otros paquetes compatibles con esta ruta.",
      data: { type: "trip_auto_created", tripId: trip.id },
    });
  } catch (err) {
    logger?.warn(
      { err, event: "notification_dispatch_failed", tripId: trip.id },
      "No se pudo enviar la push de viaje auto-creado"
    );
  }
}

export interface ListMyOffersResult {
  items: OfferWithShipmentContext[];
  page: number;
  limit: number;
  total: number;
}

/**
 * MOVO-188 (fix de review, PR #142): con precios en ARS es COMÚN que varias ofertas
 * coincidan centavo a centavo (redondeo a valores "de punta" tipo 5000/5500) -- un
 * `orderBy: priceOffered` solo no alcanza, Postgres no garantiza qué fila queda
 * primero entre iguales, así que el `rank` podía cambiar solo entre dos llamadas sin
 * que nada cambiara en la realidad. Cascada de desempate (decisión de producto, no
 * pedida por ningún AC de MOVO-188): a igual precio, gana quien tiene mejor
 * reputación `asCarrier` (MOVO-147) -- información real para decidir, no solo orden
 * estable; a igual reputación, quien entregó más envíos como transportista (más
 * historial verificable); a igual todo eso, quien ofertó primero (`createdAt`); el
 * `id` es el piso final, solo para que el orden sea 100% determinístico incluso en el
 * caso de laboratorio de dos ofertas idénticas en todo menos el id.
 *
 * `reputationScore`/`deliveredCount` ausentes (competidor sin datos) valen lo mínimo
 * posible -- no benefician a nadie por que falte su dato, nunca ganan un desempate
 * real por default.
 */
function compareCompetingOffers(
  a: CompetingOffer,
  b: CompetingOffer,
  reputationByCarrier: Map<string, number | null>,
  deliveredCountByCarrier: Map<string, number>
): number {
  if (a.priceOffered !== b.priceOffered) {
    return a.priceOffered - b.priceOffered;
  }
  const reputationA = reputationByCarrier.get(a.carrierId) ?? -Infinity;
  const reputationB = reputationByCarrier.get(b.carrierId) ?? -Infinity;
  if (reputationA !== reputationB) {
    return reputationB - reputationA;
  }
  const deliveredA = deliveredCountByCarrier.get(a.carrierId) ?? 0;
  const deliveredB = deliveredCountByCarrier.get(b.carrierId) ?? 0;
  if (deliveredA !== deliveredB) {
    return deliveredB - deliveredA;
  }
  if (a.createdAt.getTime() !== b.createdAt.getTime()) {
    return a.createdAt.getTime() - b.createdAt.getTime();
  }
  return a.id.localeCompare(b.id);
}

/**
 * MOVO-188 (AC2/AC3): ubica la oferta propia dentro de `rankedOffers` (ya resuelto el
 * desempate completo por el caller) y convierte el piso/techo a neto. `rankedOffers`
 * siempre incluye la oferta propia (viene de la misma query que la trajo como
 * `pending`) -- si no aparece, es una carrera entre la lectura de `listByCarrier` y
 * este batch (ej. se aceptó/retiró justo en el medio); se degrada a `null` en vez de
 * reportar una posición inventada.
 */
function buildCompetitiveRank(
  offerId: string,
  rankedOffers: CompetingOffer[],
  commissionRate: number
): OfferCompetitiveRank | null {
  const rank = rankedOffers.findIndex((offer) => offer.id === offerId) + 1;
  if (rank === 0) {
    return null;
  }
  const priceOffers = rankedOffers.map((offer) => offer.priceOffered);
  return {
    rank,
    total: rankedOffers.length,
    lowestPriceNetArs: computeNetFromGross(Math.min(...priceOffers), commissionRate),
    highestPriceNetArs: computeNetFromGross(Math.max(...priceOffers), commissionRate),
  };
}

function isRankableOffer(item: OfferWithShipmentContext): boolean {
  return item.status === OfferStatus.PENDING && item.shipment.status === ShipmentStatus.PUBLISHED;
}

/**
 * MOVO-190: extraído del cuerpo de `listMyOffers` (antes inline) para que
 * `getOfferDetail` pueda resolver `competitiveRank` de una sola oferta sin
 * duplicar el batch/desempate -- mismo criterio de "un único `now`" que el resto
 * del módulo (MOVO-188): el caller lo comparte con la lectura de la(s) oferta(s)
 * para no correr el riesgo de carrera de expiración entre dos `new Date()`
 * independientes.
 */
async function attachCompetitiveRanks(
  items: OfferWithShipmentContext[],
  now: Date,
  offerRepository: OfferRepository,
  shipmentRepository: ShipmentRepository,
  getCarrierReputationScores?: GetCarrierReputationScores
): Promise<OfferWithShipmentContext[]> {
  const rankableShipmentIds = [...new Set(items.filter(isRankableOffer).map((item) => item.shipmentId))];
  const pendingByShipmentRaw =
    rankableShipmentIds.length > 0
      ? await offerRepository.listPendingOffersByShipmentIds(rankableShipmentIds, now)
      : new Map<string, CompetingOffer[]>();

  const competingCarrierIds = [...new Set([...pendingByShipmentRaw.values()].flat().map((offer) => offer.carrierId))];
  const [reputationByCarrier, deliveredCountByCarrier] =
    competingCarrierIds.length > 0
      ? await Promise.all([
          getCarrierReputationScores
            ? getCarrierReputationScores(competingCarrierIds)
            : Promise.resolve(new Map<string, number | null>()),
          shipmentRepository.countDeliveredAsCarrierByIds(competingCarrierIds),
        ])
      : [new Map<string, number | null>(), new Map<string, number>()];

  const pendingByShipment = new Map(
    [...pendingByShipmentRaw.entries()].map(([shipmentId, offers]) => [
      shipmentId,
      [...offers].sort((a, b) => compareCompetingOffers(a, b, reputationByCarrier, deliveredCountByCarrier)),
    ])
  );

  const commissionRate = getCommissionConfig().movoCommissionRate;

  return items.map((item) => ({
    ...item,
    competitiveRank: isRankableOffer(item)
      ? buildCompetitiveRank(item.id, pendingByShipment.get(item.shipmentId) ?? [], commissionRate)
      : null,
  }));
}

export function createOffersService(
  offerRepository: OfferRepository,
  shipmentRepository: ShipmentRepository,
  notificationsClient?: NotificationsClient,
  logger?: OffersServiceLogger,
  /** MOVO-188: opcional -- sin inyectar (tests que no lo necesitan), el desempate
   * salta directo al criterio de envíos entregados/antigüedad, nunca rompe. */
  getCarrierReputationScores?: GetCarrierReputationScores,
  /** MOVO-234: opcional -- sin inyectar, `acceptOffer` sigue auto-creando el `Trip`
   * (AC1 no depende de `usersClient`), solo que `vehicleType` degrada directo al
   * placeholder sin intentar resolver la ficha de vehículo real. */
  usersClient?: UsersClient
) {
  return {
    /**
     * MOVO-145 (AC1-AC5): ofertas propias del transportista autenticado.
     *
     * MOVO-188 (AC1/AC2/AC5): suma `competitiveRank` a cada ítem `pending` cuyo envío
     * sigue `published` -- una oferta puede seguir `pending` en base sobre un envío ya
     * cancelado (`cancelShipment` no toca las filas de `offers`, solo notifica, ver
     * shipments.service.ts) y ese caso no compite contra nadie. Resuelto en batch: una
     * sola query sobre los `shipmentId` distintos de la página, nunca una por ítem --
     * el desempate (reputación/envíos entregados) agrega como mucho dos queries MÁS
     * en total para toda la página (batch sobre los `carrierId` únicos que compiten),
     * nunca una por competidor.
     */
    async listMyOffers(
      carrierId: string,
      page: number,
      limit: number,
      status?: OfferStatus
    ): Promise<ListMyOffersResult> {
      // Mismo instante para las dos queries de abajo -- ver el comentario de
      // `mapOffer` en offer-repository.ts sobre la carrera de MOVO-188 que esto evita.
      const now = new Date();
      const { items, total } = await offerRepository.listByCarrier(carrierId, page, limit, status, now);

      const itemsWithRank = await attachCompetitiveRanks(
        items,
        now,
        offerRepository,
        shipmentRepository,
        getCarrierReputationScores
      );

      return { items: itemsWithRank, page, limit, total };
    },

    /**
     * MOVO-190: detalle completo de una oferta propia -- mismo shape que un ítem de
     * `listMyOffers` (incluye `shipment`/`competitiveRank`/`viewedAtBySender`), para
     * que el mobile (MOVO-182) pueda "abrir" una oferta puntual desde la lista sin un
     * segundo contrato. Autorización trivial (dueño = `carrierId === callerId`),
     * mismo criterio que `withdrawOffer`/`updateOffer` -- no es el emisor mirando
     * ofertas ajenas (`assertIsSender*` de shipments), acá el dueño es siempre el
     * transportista. `viewedAtBySender` NUNCA se marca desde acá: ese campo es "el
     * EMISOR vio la oferta" (MOVO-189), se marca solo desde
     * `GET /shipments/:id/offers` cuando el caller es el emisor real.
     */
    async getOfferDetail(offerId: string, callerId: string): Promise<OfferWithShipmentContext> {
      const now = new Date();
      const offer = await offerRepository.findByIdWithShipmentContext(offerId, now);
      if (!offer) {
        throw new ApiError(404, "OFFER_NOT_FOUND", "No existe una oferta con ese id.");
      }

      if (offer.carrierId !== callerId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el transportista dueño de la oferta puede verla.");
      }

      const [withRank] = await attachCompetitiveRanks(
        [offer],
        now,
        offerRepository,
        shipmentRepository,
        getCarrierReputationScores
      );
      return withRank;
    },

    /**
     * AC6/AC7 de MOVO-144: delega en `offerRepository.acceptOffer()` (MOVO-102),
     * que ya resuelve todo el dominio (transacción atómica, bloqueo optimista,
     * demás ofertas pending -> superseded). Este método solo resuelve
     * autorización (solo el emisor del envío dueño de la oferta) y dispara las
     * notificaciones de AC9.
     */
    async acceptOffer(offerId: string, callerId: string): Promise<Offer> {
      const offer = await offerRepository.findById(offerId);
      if (!offer) {
        throw new ApiError(404, "OFFER_NOT_FOUND", "No existe una oferta con ese id.");
      }

      const shipment = await shipmentRepository.findById(offer.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertIsSender(shipment, callerId);

      // MOVO-234 (AC1): se resuelve el vehículo del transportista ANTES de la
      // transacción de aceptación -- I/O a `usersClient` no anidable dentro de la
      // transacción de Postgres del repositorio. Best-effort (ver
      // `resolveAutoTripVehicleType`): nunca bloquea la aceptación, en el peor caso
      // el viaje auto-creado queda con el placeholder.
      //
      // Fix de review (PR #176): SIEMPRE se resuelve, sin importar si `offer.tripId`
      // ya está seteado en esta lectura -- antes se omitía cuando no era `null`, pero
      // ese snapshot podía quedar obsoleto para cuando la transacción de
      // `offerRepository.acceptOffer()` relee la oferta: el transportista puede
      // borrar su `Trip` mientras la aceptación está en curso (permitido sobre una
      // oferta todavía `pending`, `onDelete: SetNull`), dejando `current.tripId` en
      // `null` dentro de la transacción sin que este método lo supiera de antemano.
      // Sin `autoTripDefaults` ya resuelto para ese caso, la oferta quedaba
      // `accepted` con `tripId: null` y sin ningún `Trip` compensatorio -- rompía la
      // garantía de AC1/AC2. El costo (una llamada de más a `usersClient` en el caso
      // minoritario de una oferta que YA tenía viaje) es aceptable frente a esa
      // garantía.
      const autoTripDefaults = { vehicleType: await resolveAutoTripVehicleType(usersClient, offer.carrierId, logger) };

      const {
        offer: accepted,
        shipmentId,
        superseded,
        autoCreatedTrip,
      } = await offerRepository.acceptOffer(offerId, callerId, autoTripDefaults);

      // AC9: best-effort, fire-and-forget -- la transacción de acceptOffer() ya
      // commiteó, un fallo de entrega no revierte la asignación.
      void dispatchOfferPush(notificationsClient, logger, {
        carrierId: accepted.carrierId,
        title: "Tu oferta fue aceptada",
        body: "El emisor eligió tu oferta para este envío.",
        shipmentId,
        offerId: accepted.id,
        type: "offer_accepted",
      });

      // `acceptOffer()` ya devuelve las ofertas superadas directo de la misma
      // transacción (hallazgo de review, PR #105) -- evita un `listByShipment`
      // completo aparte solo para reconstruir a quién notificar.
      void Promise.all(
        superseded.map((sibling) =>
          dispatchOfferPush(notificationsClient, logger, {
            carrierId: sibling.carrierId,
            title: "Tu oferta ya no está disponible",
            body: "El emisor eligió otra oferta para este envío.",
            shipmentId,
            offerId: sibling.id,
            type: "offer_superseded",
          })
        )
      );

      // MOVO-234 (AC3): aviso explícito del viaje auto-creado, nunca un efecto
      // silencioso -- ver dispatchAutoTripCreatedPush.
      if (autoCreatedTrip) {
        void dispatchAutoTripCreatedPush(notificationsClient, logger, autoCreatedTrip);
      }

      return accepted;
    },

    /**
     * AC8/AC9 de MOVO-144: rechazo puntual -- delega en `offerRepository.reject()`,
     * el envío sigue `published` (no lo toca este método) y el transportista puede
     * volver a ofertar (fila nueva). Solo notifica al rechazado.
     */
    async rejectOffer(offerId: string, callerId: string): Promise<Offer> {
      const offer = await offerRepository.findById(offerId);
      if (!offer) {
        throw new ApiError(404, "OFFER_NOT_FOUND", "No existe una oferta con ese id.");
      }

      const shipment = await shipmentRepository.findById(offer.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertIsSender(shipment, callerId);

      const rejected = await offerRepository.reject(offerId);

      void dispatchOfferPush(notificationsClient, logger, {
        carrierId: rejected.carrierId,
        title: "Tu oferta fue rechazada",
        body: "El emisor rechazó tu oferta para este envío.",
        shipmentId: rejected.shipmentId,
        offerId: rejected.id,
        type: "offer_rejected",
      });

      return rejected;
    },

    /**
     * AC8 de MOVO-143: el transportista retira su propia oferta `pending`. Solo
     * resuelve autorización (dueño de la oferta) — `offerRepository.withdraw()` ya
     * hace el compare-and-swap y valida la transición vía `offer-state-machine.ts`
     * (409 `OFFER_INVALID_TRANSITION` sobre una ya resuelta/vencida, 409
     * `OFFER_CONCURRENT_MODIFICATION` sobre el caso concurrente, ambos ya mapeados en
     * `error-handler.ts` desde MOVO-144). Sin notificación push -- no la pide el AC.
     */
    async withdrawOffer(offerId: string, callerId: string): Promise<Offer> {
      const offer = await offerRepository.findById(offerId);
      if (!offer) {
        throw new ApiError(404, "OFFER_NOT_FOUND", "No existe una oferta con ese id.");
      }

      if (offer.carrierId !== callerId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el transportista dueño de la oferta puede retirarla.");
      }

      return offerRepository.withdraw(offerId);
    },

    /**
     * MOVO-181 (AC1-AC3): el transportista modifica precio y/o fecha/franja de retiro
     * propuestos de su propia oferta `pending`. Resuelve autorización y las mismas
     * validaciones sincrónicas que `createOfferForShipment` (MOVO-143/177) antes de
     * cualquier I/O -- `offerRepository.update()` (MOVO-181) resuelve la precondición
     * de estado efectivo, la revalidación de rango de `offeredDate` contra
     * `pickupDate` y el compare-and-swap contra un accept/reject/withdraw concurrente.
     */
    async updateOffer(offerId: string, callerId: string, patch: PatchOfferInput): Promise<Offer> {
      const offer = await offerRepository.findById(offerId);
      if (!offer) {
        throw new ApiError(404, "OFFER_NOT_FOUND", "No existe una oferta con ese id.");
      }

      if (offer.carrierId !== callerId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el transportista dueño de la oferta puede modificarla.");
      }

      if (patch.priceOfferedArs !== undefined && patch.priceOfferedArs <= 0) {
        throw new ApiError(422, "VALIDATION_FAILED", "El precio ofertado tiene que ser mayor a 0.");
      }

      // Mismo criterio "both-or-neither" que AC6 de MOVO-143/177: mandar un solo
      // extremo de la franja es un estado a medio construir, nunca una edición
      // parcial válida de "solo el inicio" o "solo el fin". `null` cuenta como
      // "presente" acá (a diferencia de `undefined`) -- es el valor que resetea la
      // franja a la ventana del envío.
      const hasWindowStart = patch.offeredPickupTimeWindowStart !== undefined;
      const hasWindowEnd = patch.offeredPickupTimeWindowEnd !== undefined;
      if (hasWindowStart !== hasWindowEnd) {
        throw new ApiError(
          422,
          "VALIDATION_FAILED",
          "La franja horaria de retiro propuesta requiere both inicio y fin, o ninguno."
        );
      }
      // Ambos null: reset explícito, sin validar rango horario (no hay franja que
      // validar). Ambos string: validar como antes. Mixto (uno null, otro string) no
      // es un estado representable -- mismo error que "solo un extremo".
      if (hasWindowStart && hasWindowEnd) {
        const bothNull = patch.offeredPickupTimeWindowStart === null && patch.offeredPickupTimeWindowEnd === null;
        const bothStrings =
          typeof patch.offeredPickupTimeWindowStart === "string" &&
          typeof patch.offeredPickupTimeWindowEnd === "string";
        if (!bothNull && !bothStrings) {
          throw new ApiError(
            422,
            "VALIDATION_FAILED",
            "La franja horaria de retiro propuesta requiere both inicio y fin, o ninguno."
          );
        }
        if (bothStrings) {
          // La franja se valida contra el `offeredDate` EFECTIVO -- el nuevo si el
          // patch también lo cambia, el ya persistido si no.
          const effectiveOfferedDateStr = patch.offeredDate ?? offer.offeredDate.toISOString().slice(0, 10);
          const windowStartAt = combineDateAndTime(
            effectiveOfferedDateStr,
            patch.offeredPickupTimeWindowStart as string
          );
          const windowEndAt = combineDateAndTime(effectiveOfferedDateStr, patch.offeredPickupTimeWindowEnd as string);
          if (windowEndAt <= windowStartAt) {
            throw new ApiError(
              422,
              "OFFER_PICKUP_WINDOW_INVALID",
              "El fin de la franja de retiro propuesta debe ser posterior al inicio."
            );
          }
        }
      }

      // Mismo bug de `expiresAt` corregido en `createOfferForShipment`
      // (shipments.service.ts, sin ticket propio): si el patch cambia `offeredDate`
      // y/o la franja, la ventana de retiro EFECTIVA de la oferta cambió con él, así
      // que `expiresAt` tiene que recomputarse -- dejarlo como estaba habría vencido
      // la oferta antes de tiempo (fecha adelantada) o nunca (fecha atrasada). Un
      // patch de solo precio no la toca (`undefined`, "no tocar" para el
      // repositorio) -- no amerita el fetch extra del envío.
      let expiresAt: Date | undefined;
      if (patch.offeredDate !== undefined || hasWindowStart) {
        const shipment = await shipmentRepository.findById(offer.shipmentId);
        if (!shipment) {
          throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
        }
        const effectiveOfferedDateStr = patch.offeredDate ?? offer.offeredDate.toISOString().slice(0, 10);
        const effectiveWindowEndAnchored =
          hasWindowEnd && typeof patch.offeredPickupTimeWindowEnd === "string"
            ? toEpochTime(patch.offeredPickupTimeWindowEnd)
            : hasWindowEnd && patch.offeredPickupTimeWindowEnd === null
              ? shipment.pickupTimeWindowEnd // reset explícito -- vuelve a la ventana del envío
              : offer.offeredPickupTimeWindowEnd
                ? toEpochTime(offer.offeredPickupTimeWindowEnd)
                : shipment.pickupTimeWindowEnd;
        expiresAt = pickupWindowEndInstant(anchorDateUtc(effectiveOfferedDateStr), effectiveWindowEndAnchored);
      }

      return offerRepository.update(offerId, {
        priceOffered:
          patch.priceOfferedArs !== undefined ? computeOfferGrossPrice(patch.priceOfferedArs).grossArs : undefined,
        offeredDate: patch.offeredDate !== undefined ? anchorDateUtc(patch.offeredDate) : undefined,
        offeredPickupTimeWindowStart: hasWindowStart
          ? patch.offeredPickupTimeWindowStart === null
            ? null
            : normalizeTime(patch.offeredPickupTimeWindowStart as string)
          : undefined,
        offeredPickupTimeWindowEnd: hasWindowEnd
          ? patch.offeredPickupTimeWindowEnd === null
            ? null
            : normalizeTime(patch.offeredPickupTimeWindowEnd as string)
          : undefined,
        expiresAt,
      });
    },
  };
}
