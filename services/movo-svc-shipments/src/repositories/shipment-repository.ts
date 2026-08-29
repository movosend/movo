import { ShipmentStatus } from "@movo/shared";
import { Prisma, PrismaClient, Shipment as ShipmentRow, ShipmentEvent as ShipmentEventRow, ShipmentPhoto as ShipmentPhotoRow } from "../generated/prisma/client";
import {
  INITIAL_SHIPMENT_STATUS,
  InsufficientCreationPhotosError,
  MIN_CREATION_PHOTOS_TO_PUBLISH,
  transition,
} from "../domain/shipment-state-machine";
import {
  Shipment,
  ShipmentEvent,
  ShipmentPhoto,
  AvailableShipment,
  CreateShipmentInput,
  PackageType,
  PhotoStage,
  parseShipmentStatus,
} from "../models/shipment";

function mapShipment(row: ShipmentRow): Shipment {
  return {
    id: row.id,
    senderId: row.senderId,
    receiverId: row.receiverId,
    carrierId: row.carrierId,
    packageType: row.packageType,
    weightKg: row.weightKg.toNumber(),
    lengthCm: row.lengthCm.toNumber(),
    widthCm: row.widthCm.toNumber(),
    heightCm: row.heightCm.toNumber(),
    description: row.description,
    urgent: row.urgent,
    pickupAddress: row.pickupAddress,
    pickupLat: row.pickupLat.toNumber(),
    pickupLng: row.pickupLng.toNumber(),
    deliveryAddress: row.deliveryAddress,
    deliveryLat: row.deliveryLat.toNumber(),
    deliveryLng: row.deliveryLng.toNumber(),
    pickupDate: row.pickupDate,
    pickupTimeWindowStart: row.pickupTimeWindowStart,
    pickupTimeWindowEnd: row.pickupTimeWindowEnd,
    suggestedPriceArs: row.suggestedPriceArs ? row.suggestedPriceArs.toNumber() : null,
    calculationMethod: row.calculationMethod,
    agreedPriceArs: row.agreedPriceArs ? row.agreedPriceArs.toNumber() : null,
    paymentMethod: row.paymentMethod,
    status: parseShipmentStatus(row.status, "status"),
    lastStatusChangedAt: row.lastStatusChangedAt,
    deliveredAt: row.deliveredAt,
    receiverConfirmationDeadline: row.receiverConfirmationDeadline,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEvent(row: ShipmentEventRow): ShipmentEvent {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    fromStatus: row.fromStatus ? parseShipmentStatus(row.fromStatus, "from_status") : null,
    toStatus: parseShipmentStatus(row.toStatus, "to_status"),
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function isUniquePhotoConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function mapPhoto(row: ShipmentPhotoRow): ShipmentPhoto {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    stage: row.stage,
    s3Key: row.s3Key,
    createdAt: row.createdAt,
  };
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * MOVO-142: bounding box en JS antes de la query -- descarta la mayoría de las filas
 * vía los índices `shipments_status_pickup_lat_lng_idx`/`..._delivery_lat_lng_idx`
 * (AC2), el Haversine de la query SQL solo afina sobre lo que sobrevive al rango.
 * `Math.max(cos, 1e-6)` es defensa en profundidad para latitudes cerca del polo (no
 * aplica en la práctica a Argentina) -- sin esto, `lngDelta` podría dividir por ~0.
 */
function boundingBox(lat: number, lng: number, radiusKm: number) {
  const clampedLat = Math.max(-90, Math.min(90, lat));
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.max(Math.cos(toRadians(clampedLat)), 1e-6));
  return { latMin: lat - latDelta, latMax: lat + latDelta, lngMin: lng - lngDelta, lngMax: lng + lngDelta };
}

/**
 * MOVO-142: primer `$queryRaw` con lógica de dominio del monorepo (hasta ahora solo
 * `SELECT 1` en healthchecks) -- Haversine entre un punto fijo (origen/destino del
 * transportista) y una columna de la fila (pickup_lat/lng o delivery_lat/lng). Misma
 * fórmula que `haversineKm()` de `shipments.service.ts` (EARTH_RADIUS_KM=6371),
 * reescrita en SQL porque Prisma no puede expresar trigonometría. Building block
 * parametrizado (tagged template de Prisma, nunca `$queryRawUnsafe`) -- el nombre de
 * columna SIEMPRE viaja como `Prisma.sql` interno (literal fijo de este archivo, nunca
 * interpolación de un valor externo), los valores del caller (`lat`/`lng`) sí van
 * parametrizados por el tag.
 */
function haversinePointToColumnKm(lat: number, lng: number, latCol: Prisma.Sql, lngCol: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    ${EARTH_RADIUS_KM} * 2 * asin(sqrt(
      power(sin(radians(${latCol} - ${lat}) / 2), 2) +
      cos(radians(${lat})) * cos(radians(${latCol})) *
      power(sin(radians(${lngCol} - ${lng}) / 2), 2)
    ))
  )`;
}

/** MOVO-142 (`maxDistanceKm`): misma fórmula que `haversinePointToColumnKm`, pero entre
 * dos PARES de columnas de la misma fila (pickup vs delivery del propio envío) en vez
 * de un punto fijo del caller contra una columna. */
function haversineColumnToColumnKm(lat1Col: Prisma.Sql, lng1Col: Prisma.Sql, lat2Col: Prisma.Sql, lng2Col: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    ${EARTH_RADIUS_KM} * 2 * asin(sqrt(
      power(sin(radians(${lat2Col} - ${lat1Col}) / 2), 2) +
      cos(radians(${lat1Col})) * cos(radians(${lat2Col})) *
      power(sin(radians(${lng2Col} - ${lng1Col}) / 2), 2)
    ))
  )`;
}

/**
 * MOVO-142: `WHERE` compartido entre la query de datos y la de conteo de
 * `listAvailable` -- mismo espíritu que `offerStatusWhere()` en
 * `offer-repository.ts`, única fuente de verdad de un WHERE reusado dos veces, para
 * que nunca diverjan entre sí.
 */
function availableShipmentsWhereSql(params: {
  callerId: string;
  pickupBox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  deliveryBox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
}): Prisma.Sql {
  return Prisma.sql`
    status = 'published'
      AND sender_id <> ${params.callerId}::uuid
      AND receiver_id <> ${params.callerId}::uuid
      AND pickup_lat BETWEEN ${params.pickupBox.latMin} AND ${params.pickupBox.latMax}
      AND pickup_lng BETWEEN ${params.pickupBox.lngMin} AND ${params.pickupBox.lngMax}
      AND delivery_lat BETWEEN ${params.deliveryBox.latMin} AND ${params.deliveryBox.latMax}
      AND delivery_lng BETWEEN ${params.deliveryBox.lngMin} AND ${params.deliveryBox.lngMax}
  `;
}

/**
 * Fila cruda de `$queryRaw` -- a diferencia de `db.shipment.findMany()`, Prisma NO
 * aplica acá el mapeo `@map` (columnas en `snake_case` reales de Postgres) ni convierte
 * `numeric`/`decimal` a `Prisma.Decimal`: el driver `pg` los devuelve como `string` para
 * no perder precisión con floats. `timestamp`/`timestamptz`/`date` sí vuelven como
 * `Date` (parser default de `pg`).
 */
interface AvailableShipmentRow {
  id: string;
  package_type: PackageType;
  weight_kg: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  description: string | null;
  urgent: boolean;
  pickup_address: string;
  pickup_lat: string;
  pickup_lng: string;
  delivery_address: string;
  delivery_lat: string;
  delivery_lng: string;
  pickup_date: Date;
  pickup_time_window_start: Date;
  pickup_time_window_end: Date;
  suggested_price_ars: string | null;
  calculation_method: string | null;
  status: string;
  created_at: Date;
  pickup_distance_km: string;
  delivery_distance_km: string;
  distance_km: string;
}

function mapAvailableShipmentRow(row: AvailableShipmentRow): AvailableShipment {
  return {
    id: row.id,
    packageType: row.package_type,
    weightKg: Number(row.weight_kg),
    lengthCm: Number(row.length_cm),
    widthCm: Number(row.width_cm),
    heightCm: Number(row.height_cm),
    description: row.description,
    urgent: row.urgent,
    pickupAddress: row.pickup_address,
    pickupLat: Number(row.pickup_lat),
    pickupLng: Number(row.pickup_lng),
    deliveryAddress: row.delivery_address,
    deliveryLat: Number(row.delivery_lat),
    deliveryLng: Number(row.delivery_lng),
    pickupDate: row.pickup_date,
    pickupTimeWindowStart: row.pickup_time_window_start,
    pickupTimeWindowEnd: row.pickup_time_window_end,
    suggestedPriceArs: row.suggested_price_ars !== null ? Number(row.suggested_price_ars) : null,
    calculationMethod: row.calculation_method,
    status: parseShipmentStatus(row.status, "status"),
    createdAt: row.created_at,
    pickupDistanceKm: Number(row.pickup_distance_km),
    deliveryDistanceKm: Number(row.delivery_distance_km),
    distanceKm: Number(row.distance_km),
  };
}

export interface ShipmentRepository {
  create(input: CreateShipmentInput): Promise<Shipment>;
  findById(id: string): Promise<Shipment | null>;
  /**
   * Única vía de escritura de `status` (AC2 de MOVO-104): valida la
   * transición con `shipment-state-machine.ts` (MOVO-105) antes de tocar la
   * fila, y dentro de la misma transacción registra el evento en
   * `shipment_events`. Ningún otro método de este repositorio toca `status`.
   * Compare-and-swap contra `status` (MOVO-118): lanza
   * `ShipmentConcurrentModificationError` si otra transición concurrente ya
   * ganó la carrera por el UPDATE.
   */
  updateStatus(id: string, to: ShipmentStatus, actorId: string | null, reason?: string): Promise<Shipment>;
  listEvents(shipmentId: string): Promise<ShipmentEvent[]>;
  addPhoto(shipmentId: string, stage: PhotoStage, s3Key: string): Promise<ShipmentPhoto>;
  listPhotos(shipmentId: string): Promise<ShipmentPhoto[]>;
  /**
   * MOVO-124: ¿este `s3Key` ya fue confirmado (tiene fila en `shipment_photos`)?
   * Fuente de verdad del sweep de fotos huérfanas -- el tracking de "pendiente" vive en
   * Redis (best-effort, puede perder la baja si `confirmPhoto` falla al hacer `ZREM`),
   * así que antes de borrar un objeto de S3 el sweep siempre revalida acá (AC3 de
   * MOVO-124: nunca confiar solo en que Redis diga "no confirmado").
   */
  existsPhotoByS3Key(s3Key: string): Promise<boolean>;
  /**
   * Envíos donde el usuario participa como sender o como receiver (AC9 de MOVO-80 —
   * todavía no hay rol de "carrier" asignado en este sprint). Paginado, más reciente
   * primero.
   */
  listByUser(userId: string, page: number, limit: number): Promise<{ items: Shipment[]; total: number }>;
  /**
   * MOVO-142: envíos `published` que encajan en el trayecto del transportista (AND:
   * pickup dentro de `radiusKm` del origen Y delivery dentro de `radiusKm` del
   * destino), excluyendo los propios del caller (sender o receiver).
   * `maxDistanceKm` (opcional) tapea la distancia propia pickup→delivery del envío,
   * sin relación con el trayecto del caller. Orden por `distanceKm` (suma de las dos
   * distancias parciales) ascendente. Paginado con el mismo contrato que
   * `listByUser`.
   */
  listAvailable(params: {
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
    radiusKm: number;
    maxDistanceKm?: number;
    excludeUserId: string;
    page: number;
    limit: number;
  }): Promise<{ items: AvailableShipment[]; total: number }>;
  /**
   * MOVO-130 AC3: Envíos en awaiting_receiver_confirmation cuya deadline ya venció.
   * Lote acotado ordenado por deadline ascendente.
   */
  findExpiredAwaitingConfirmation(deadline: Date, limit: number): Promise<Shipment[]>;
  /**
   * MOVO-134: soporte del endpoint interno de baja de cuenta de `svc-users` -- ¿el
   * usuario (como sender, receiver o carrier) tiene algún envío en un estado no
   * terminal? Separa `disputed` del resto (`awaiting_receiver_confirmation`,
   * `published`, `assignment_pending`, `assigned`, `in_transit`) porque el mensaje de
   * error del lado de `svc-users` es distinto (una disputa no la resuelve el usuario
   * cancelando, necesita a un admin).
   */
  hasActiveShipmentsForUser(userId: string): Promise<{ hasActiveDispute: boolean; hasActiveShipments: boolean }>;
  /**
   * MOVO-147 AC3/AC6: envíos completados (`delivered`) de un usuario como emisor y
   * como transportista -- lo que hoy `svc-users` devuelve hardcodeado en
   * `{ asSender: 0, asCarrier: 0 }` (`placeholderTransactionCounts()`). Dos `COUNT()`
   * independientes en vez de un `groupBy`: `senderId`/`carrierId` son columnas
   * distintas de la misma fila, no un único campo agrupable, así que un `groupBy` no
   * aplica acá -- lo que sí exige AC6 (resolverlo con un agregado, nunca trayendo los
   * envíos del usuario a memoria para contarlos en JS) se cumple igual con las dos
   * queries de `COUNT`.
   */
  countCompletedTransactions(userId: string): Promise<{ asSender: number; asCarrier: number }>;
}

export class ShipmentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`No existe un envío con id '${id}'`);
    this.name = "ShipmentNotFoundError";
  }
}

/**
 * MOVO-118: otra transición concurrente sobre el mismo envío ganó la carrera
 * por el UPDATE entre la lectura de `status` de este caller y su propio
 * write. Mismo patrón de compare-and-swap que `OfferConcurrentModificationError`
 * en `offer-repository.ts` (MOVO-102) — no hace falta `SELECT...FOR UPDATE`
 * ni `$queryRaw`, el `updateMany` condicionado por `status` ya usa el mismo
 * mecanismo de locking de Postgres (EvalPlanQual bajo READ COMMITTED).
 */
export class ShipmentConcurrentModificationError extends Error {
  constructor(public readonly id: string) {
    super(`El envío '${id}' fue modificado por otra transición concurrente`);
    this.name = "ShipmentConcurrentModificationError";
  }
}

export function createShipmentRepository(db: PrismaClient): ShipmentRepository {
  return {
    async create(input: CreateShipmentInput): Promise<Shipment> {
      const row = await db.$transaction(async (tx) => {
        const created = await tx.shipment.create({
          data: {
            senderId: input.senderId,
            receiverId: input.receiverId,
            packageType: input.packageType,
            weightKg: input.weightKg,
            lengthCm: input.lengthCm,
            widthCm: input.widthCm,
            heightCm: input.heightCm,
            description: input.description,
            urgent: input.urgent ?? false,
            pickupAddress: input.pickupAddress,
            pickupLat: input.pickupLat,
            pickupLng: input.pickupLng,
            deliveryAddress: input.deliveryAddress,
            deliveryLat: input.deliveryLat,
            deliveryLng: input.deliveryLng,
            pickupDate: input.pickupDate,
            pickupTimeWindowStart: input.pickupTimeWindowStart,
            pickupTimeWindowEnd: input.pickupTimeWindowEnd,
            suggestedPriceArs: input.suggestedPriceArs,
            calculationMethod: input.calculationMethod,
            receiverConfirmationDeadline: input.receiverConfirmationDeadline ?? null,
            status: INITIAL_SHIPMENT_STATUS,
            lastStatusChangedAt: new Date(),
          },
        });

        await tx.shipmentEvent.create({
          data: {
            shipmentId: created.id,
            fromStatus: null,
            toStatus: INITIAL_SHIPMENT_STATUS,
            actorId: input.senderId,
            reason: null,
          },
        });

        return created;
      });

      return mapShipment(row);
    },

    async findById(id: string): Promise<Shipment | null> {
      const row = await db.shipment.findUnique({ where: { id } });
      return row ? mapShipment(row) : null;
    },

    async updateStatus(id: string, to: ShipmentStatus, actorId: string | null, reason?: string): Promise<Shipment> {
      // Esta lectura ya NO es la fuente de verdad de la carrera (MOVO-118) —
      // solo sirve para validar la transición y la precondición de fotos
      // antes de pagar el costo de abrir una transacción. La corrección real
      // viene del `updateMany` condicionado por `status` de abajo.
      const current = await db.shipment.findUnique({ where: { id } });
      if (!current) {
        throw new ShipmentNotFoundError(id);
      }

      const from = parseShipmentStatus(current.status, "status");
      // Lanza InvalidShipmentTransitionError si la transición no es válida —
      // ningún UPDATE se ejecuta si esto tira.
      transition(from, to);

      // AC6 de MOVO-81: precondición de negocio sobre una transición que ya es
      // estructuralmente válida — publicar exige evidencia mínima del paquete. Vive acá
      // (la única vía de escritura de `status`, AC2 de MOVO-104) para que cualquier
      // caller futuro (MOVO-16, receptor confirma) quede cubierto sin tener que
      // reimplementar el chequeo.
      if (to === ShipmentStatus.PUBLISHED) {
        const creationPhotoCount = await db.shipmentPhoto.count({
          where: { shipmentId: id, stage: PhotoStage.creation },
        });
        if (creationPhotoCount < MIN_CREATION_PHOTOS_TO_PUBLISH) {
          throw new InsufficientCreationPhotosError(id, creationPhotoCount);
        }
      }

      const now = new Date();
      const deliveredAt = to === ShipmentStatus.DELIVERED ? now : current.deliveredAt;

      const row = await db.$transaction(async (tx) => {
        // MOVO-118: compare-and-swap, mismo patrón que
        // `offer-repository.ts#acceptOffer` (MOVO-102/AC9). El WHERE
        // condiciona por `status: from` (el valor leído más arriba) — bajo
        // READ COMMITTED, el UPDATE toma el lock de fila y, si otra
        // transición concurrente ya commiteó un cambio de status distinto,
        // EvalPlanQual hace que este WHERE deje de matchear y `count` da 0.
        const updated = await tx.shipment.updateMany({
          where: { id, status: from },
          data: {
            status: to,
            lastStatusChangedAt: now,
            deliveredAt,
          },
        });

        if (updated.count === 0) {
          throw new ShipmentConcurrentModificationError(id);
        }

        await tx.shipmentEvent.create({
          data: {
            shipmentId: id,
            fromStatus: from,
            toStatus: to,
            actorId,
            reason: reason ?? null,
          },
        });

        // `updateMany` no devuelve la fila actualizada (a diferencia de
        // `update`) — se reconstruye a mano en vez de pagar un SELECT extra,
        // mismo criterio que `accepted` en offer-repository.ts#acceptOffer.
        return { ...current, status: to, lastStatusChangedAt: now, deliveredAt, updatedAt: now };
      });

      return mapShipment(row);
    },

    async listEvents(shipmentId: string): Promise<ShipmentEvent[]> {
      const rows = await db.shipmentEvent.findMany({
        where: { shipmentId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapEvent);
    },

    async addPhoto(shipmentId: string, stage: PhotoStage, s3Key: string): Promise<ShipmentPhoto> {
      try {
        const row = await db.shipmentPhoto.create({
          data: { shipmentId, stage, s3Key },
        });
        return mapPhoto(row);
      } catch (error) {
        // Fix de review (PR #76, tmvergara): confirmar el mismo `s3Key` dos veces
        // (reintento del cliente) violaba antes solo la lógica de negocio -- ahora
        // choca con `shipment_photos_shipment_id_s3_key_key`. En vez de propagar el
        // conflicto, se trata como idempotente: devuelve la fila ya registrada, así el
        // conteo de AC6 nunca cuenta la misma foto dos veces.
        if (isUniquePhotoConflict(error)) {
          const existing = await db.shipmentPhoto.findFirst({ where: { shipmentId, s3Key } });
          if (existing) {
            return mapPhoto(existing);
          }
        }
        throw error;
      }
    },

    async listPhotos(shipmentId: string): Promise<ShipmentPhoto[]> {
      const rows = await db.shipmentPhoto.findMany({
        where: { shipmentId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapPhoto);
    },

    async existsPhotoByS3Key(s3Key: string): Promise<boolean> {
      const row = await db.shipmentPhoto.findFirst({ where: { s3Key }, select: { id: true } });
      return row !== null;
    },

    async listByUser(userId: string, page: number, limit: number): Promise<{ items: Shipment[]; total: number }> {
      const where = { OR: [{ senderId: userId }, { receiverId: userId }] };
      const [rows, total] = await Promise.all([
        db.shipment.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.shipment.count({ where }),
      ]);
      return { items: rows.map(mapShipment), total };
    },

    async listAvailable(params: {
      originLat: number;
      originLng: number;
      destinationLat: number;
      destinationLng: number;
      radiusKm: number;
      maxDistanceKm?: number;
      excludeUserId: string;
      page: number;
      limit: number;
    }): Promise<{ items: AvailableShipment[]; total: number }> {
      const pickupBox = boundingBox(params.originLat, params.originLng, params.radiusKm);
      const deliveryBox = boundingBox(params.destinationLat, params.destinationLng, params.radiusKm);
      const where = availableShipmentsWhereSql({ callerId: params.excludeUserId, pickupBox, deliveryBox });

      const pickupDistance = haversinePointToColumnKm(params.originLat, params.originLng, Prisma.sql`pickup_lat`, Prisma.sql`pickup_lng`);
      const deliveryDistance = haversinePointToColumnKm(params.destinationLat, params.destinationLng, Prisma.sql`delivery_lat`, Prisma.sql`delivery_lng`);
      const shipmentDistance = haversineColumnToColumnKm(Prisma.sql`pickup_lat`, Prisma.sql`pickup_lng`, Prisma.sql`delivery_lat`, Prisma.sql`delivery_lng`);

      // AC (refinamiento): tope opcional sobre la distancia PROPIA del envío
      // (pickup→delivery), sin relación con el trayecto del caller -- sin default, si
      // no se manda no filtra por esto.
      const maxDistanceFilter =
        params.maxDistanceKm !== undefined ? Prisma.sql`AND shipment_distance_km <= ${params.maxDistanceKm}` : Prisma.empty;

      const skip = (params.page - 1) * params.limit;

      // Dos queries separadas (no `COUNT(*) OVER()`) para que `total` sea siempre
      // exacto incluso con una página vacía (un OFFSET más allá del último resultado
      // no debe perder el conteo real) -- mismo contrato que `listByUser`.
      const [rows, countRows] = await Promise.all([
        db.$queryRaw<AvailableShipmentRow[]>`
          WITH candidates AS (
            SELECT
              id, package_type, weight_kg, length_cm, width_cm, height_cm, description,
              urgent, pickup_address, pickup_lat, pickup_lng, delivery_address,
              delivery_lat, delivery_lng, pickup_date, pickup_time_window_start,
              pickup_time_window_end, suggested_price_ars, calculation_method, status,
              created_at,
              ${pickupDistance} AS pickup_distance_km,
              ${deliveryDistance} AS delivery_distance_km,
              ${shipmentDistance} AS shipment_distance_km
            FROM shipments.shipments
            WHERE ${where}
          )
          SELECT *, (pickup_distance_km + delivery_distance_km) AS distance_km
          FROM candidates
          WHERE pickup_distance_km <= ${params.radiusKm}
            AND delivery_distance_km <= ${params.radiusKm}
            ${maxDistanceFilter}
          ORDER BY distance_km ASC
          LIMIT ${params.limit} OFFSET ${skip}
        `,
        db.$queryRaw<{ count: bigint }[]>`
          WITH candidates AS (
            SELECT
              ${pickupDistance} AS pickup_distance_km,
              ${deliveryDistance} AS delivery_distance_km,
              ${shipmentDistance} AS shipment_distance_km
            FROM shipments.shipments
            WHERE ${where}
          )
          SELECT COUNT(*)::bigint AS count
          FROM candidates
          WHERE pickup_distance_km <= ${params.radiusKm}
            AND delivery_distance_km <= ${params.radiusKm}
            ${maxDistanceFilter}
        `,
      ]);

      return { items: rows.map(mapAvailableShipmentRow), total: Number(countRows[0]?.count ?? 0) };
    },

    async findExpiredAwaitingConfirmation(deadline: Date, limit: number): Promise<Shipment[]> {
      const rows = await db.shipment.findMany({
        where: {
          status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          receiverConfirmationDeadline: {
            lte: deadline,
          },
        },
        take: limit,
        orderBy: { receiverConfirmationDeadline: "asc" },
      });
      return rows.map(mapShipment);
    },

    async hasActiveShipmentsForUser(userId: string): Promise<{ hasActiveDispute: boolean; hasActiveShipments: boolean }> {
      const rows = await db.shipment.findMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }, { carrierId: userId }],
          status: {
            notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.REJECTED_BY_RECEIVER, ShipmentStatus.CANCELLED],
          },
        },
        select: { status: true },
      });
      return {
        hasActiveDispute: rows.some((r) => r.status === ShipmentStatus.DISPUTED),
        hasActiveShipments: rows.some((r) => r.status !== ShipmentStatus.DISPUTED),
      };
    },

    async countCompletedTransactions(userId: string): Promise<{ asSender: number; asCarrier: number }> {
      const [asSender, asCarrier] = await Promise.all([
        db.shipment.count({ where: { senderId: userId, status: ShipmentStatus.DELIVERED } }),
        db.shipment.count({ where: { carrierId: userId, status: ShipmentStatus.DELIVERED } }),
      ]);
      return { asSender, asCarrier };
    },
  };
}
