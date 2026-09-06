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
    estimatedDeliveryDate: row.estimatedDeliveryDate,
    estimatedDeliveryTimeWindowStart: row.estimatedDeliveryTimeWindowStart,
    estimatedDeliveryTimeWindowEnd: row.estimatedDeliveryTimeWindowEnd,
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
 * Usado tal cual en el modo SIN destino (círculo alrededor de un solo punto); el modo
 * CON destino usa `corridorBoundingBox` (ver abajo).
 */
function boundingBox(lat: number, lng: number, radiusKm: number) {
  const clampedLat = Math.max(-90, Math.min(90, lat));
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.max(Math.cos(toRadians(clampedLat)), 1e-6));
  return { latMin: lat - latDelta, latMax: lat + latDelta, lngMin: lng - lngDelta, lngMax: lng + lngDelta };
}

/**
 * MOVO-142 (fix, corredor de MOVO-50 -- ver comentario de `haversineSegmentDistanceKm`):
 * bounding box que contiene TODO el corredor origen→destino ensanchado `radiusKm` para
 * cada lado, no un círculo alrededor de un único punto. Se arma con el rectángulo que
 * encierra ambos extremos y se lo ensancha -- más laxo que un rectángulo orientado al
 * segmento (deja pasar algunas filas de más que el Haversine de la query filtra
 * después), pero simple y correcto: nunca excluye un punto real del corredor. Mismo
 * `pickupBox`/`deliveryBox` para las dos columnas -- en este modo ambos extremos del
 * envío se miden contra el mismo corredor, no contra dos puntos distintos.
 */
function corridorBoundingBox(originLat: number, originLng: number, destinationLat: number, destinationLng: number, radiusKm: number) {
  const midLat = Math.max(-90, Math.min(90, (originLat + destinationLat) / 2));
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.max(Math.cos(toRadians(midLat)), 1e-6));
  return {
    latMin: Math.min(originLat, destinationLat) - latDelta,
    latMax: Math.max(originLat, destinationLat) + latDelta,
    lngMin: Math.min(originLng, destinationLng) - lngDelta,
    lngMax: Math.max(originLng, destinationLng) + lngDelta,
  };
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
 * MOVO-142 (fix, corredor -- ver docs/or-tools/vrptw-spike-report.md, MOVO-50):
 * distancia perpendicular de una columna (pickup_lat/lng o delivery_lat/lng) al
 * SEGMENTO origen→destino del trayecto del transportista, con clamp a los extremos
 * (`GREATEST`/`LEAST`) -- un punto "antes" del origen o "después" del destino mide
 * contra el extremo más cercano, no contra la recta infinita.
 *
 * Reemplaza al AND de dos círculos independientes (`pickup` cerca del origen Y
 * `delivery` cerca del destino) de la primera versión: ese diseño dejaba afuera un
 * envío con retiro/entrega en el MEDIO del trayecto (ej. Oncativo entre Córdoba y
 * Villa María, el caso de estudio del spike) aunque encajara perfecto en el viaje --
 * ni el retiro ni la entrega quedaban cerca de ninguno de los dos extremos. Esta
 * fórmula es la misma que ya existía en `docs/or-tools/vrptw_prototype.py
 * #point_to_segment_distance_km` (CA6 de la spike, "prefiltro geométrico de
 * corredor"), portada a SQL en vez de reinventar el concepto.
 *
 * Proyección equirrectangular centrada en el punto medio del segmento -- origen y
 * destino son constantes del request (no de la fila), así que `kx`/`ky`/`bx`/`by` se
 * precalculan en JS; solo la posición de la columna (`px`/`py`) es SQL real. `ky =
 * 110.574` (no el `111.32` que usa `boundingBox`/`corridorBoundingBox`): mismo valor
 * que el prototipo Python, la aproximación ecuatorial más precisa para un grado de
 * latitud -- se mantiene igual acá para no reinterpretar la fórmula original.
 */
function haversineSegmentDistanceKm(
  originLat: number,
  originLng: number,
  destinationLat: number,
  destinationLng: number,
  latCol: Prisma.Sql,
  lngCol: Prisma.Sql
): Prisma.Sql {
  const midLatRad = toRadians((originLat + destinationLat) / 2);
  const kx = 111.32 * Math.cos(midLatRad);
  const ky = 110.574;
  const bx = (destinationLng - originLng) * kx;
  const by = (destinationLat - originLat) * ky;
  const ab2 = bx * bx + by * by;

  const px = Prisma.sql`((${lngCol} - ${originLng}) * ${kx})`;
  const py = Prisma.sql`((${latCol} - ${originLat}) * ${ky})`;

  if (ab2 === 0) {
    // Origen y destino coinciden (trayecto degenerado) -- distancia punto a punto
    // contra el origen, mismo caso límite que contempla el prototipo Python.
    return Prisma.sql`sqrt(power(${px}, 2) + power(${py}, 2))`;
  }

  const t = Prisma.sql`GREATEST(0, LEAST(1, ((${px}) * ${bx} + (${py}) * ${by}) / ${ab2}))`;
  return Prisma.sql`sqrt(power((${px}) - ((${t}) * ${bx}), 2) + power((${py}) - ((${t}) * ${by}), 2))`;
}

/**
 * MOVO-142 (fix de diseño): el destino es OPCIONAL -- el transportista no tiene por
 * qué tener un viaje planificado para ver envíos cerca suyo (AC1 original). Sin
 * destino, el filtro/orden se resuelve solo contra el retiro (origen); con destino, se
 * suma el AND del lado de la entrega. `WHERE` compartido entre la query de datos y la
 * de conteo de `listAvailable` -- mismo espíritu que `offerStatusWhere()` en
 * `offer-repository.ts`, única fuente de verdad de un WHERE reusado dos veces, para
 * que nunca diverjan entre sí.
 */
function availableShipmentsWhereSql(params: {
  callerId: string;
  pickupBox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  deliveryBox: { latMin: number; latMax: number; lngMin: number; lngMax: number } | null;
}): Prisma.Sql {
  const deliveryBoxFilter = params.deliveryBox
    ? Prisma.sql`
      AND delivery_lat BETWEEN ${params.deliveryBox.latMin} AND ${params.deliveryBox.latMax}
      AND delivery_lng BETWEEN ${params.deliveryBox.lngMin} AND ${params.deliveryBox.lngMax}
    `
    : Prisma.empty;
  return Prisma.sql`
    status = 'published'
      AND sender_id <> ${params.callerId}::uuid
      AND receiver_id <> ${params.callerId}::uuid
      AND pickup_lat BETWEEN ${params.pickupBox.latMin} AND ${params.pickupBox.latMax}
      AND pickup_lng BETWEEN ${params.pickupBox.lngMin} AND ${params.pickupBox.lngMax}
      ${deliveryBoxFilter}
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
  delivery_distance_km: string | null;
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
    deliveryDistanceKm: row.delivery_distance_km !== null ? Number(row.delivery_distance_km) : null,
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
   * MOVO-142: envíos `published` cerca del origen del caller (AC1 original -- no hace
   * falta tener un viaje planificado). `destinationLat`/`destinationLng` son
   * OPCIONALES: si se mandan los dos, se suma el AND del lado de la entrega (pickup
   * dentro de `radiusKm` del origen Y delivery dentro de `radiusKm` del destino,
   * pensado para "qué encaja en mi trayecto"); si no, el filtro/orden es solo contra
   * el retiro. Excluye los envíos propios del caller (sender o receiver).
   * `maxDistanceKm` (opcional) tapea la distancia propia pickup→delivery del envío,
   * sin relación con el trayecto del caller. Orden por `distanceKm` (pickup, más
   * delivery si hay destino) ascendente. Paginado con el mismo contrato que
   * `listByUser`.
   */
  listAvailable(params: {
    originLat: number;
    originLng: number;
    destinationLat?: number;
    destinationLng?: number;
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
   * Candidatos a expirar del barrido de envíos `published` sin retirar (corrección
   * directa sobre un bug reportado: `GET /shipments/available` seguía devolviendo
   * envíos cuya ventana de retiro ya había pasado, sin ticket propio). A diferencia de
   * `findExpiredAwaitingConfirmation` (que compara contra una columna `@db.Timestamptz`
   * real con un simple `lte`), acá no hay ningún instante real que Prisma pueda
   * comparar: `pickupDate`/`pickupTimeWindowEnd` son `@db.Date`/`@db.Time` ancladas
   * (reloj de pared argentino, ver `domain/pickup-window.ts`), así que esta query trae
   * los `published` más próximos a vencer (orden ascendente por fecha/hora de retiro)
   * y el filtro real de "¿ya venció?" lo hace el caller con `isPickupWindowExpired()`
   * en JS -- mismo criterio que el resto del dominio (`reputation.ts`/`rating-window.ts`)
   * de mantener la lógica de negocio en funciones puras, no replicada en SQL. Como un
   * envío vencido siempre tiene fecha de retiro más antigua que uno vigente, ordenar
   * ascendente garantiza que los vencidos queden siempre al frente del batch.
   */
  findPotentiallyExpiredPublished(limit: number): Promise<Shipment[]>;
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
  /**
   * MOVO-170: subconjunto de `usageStats` que `countCompletedTransactions` no cubre
   * (cancelados, peso promedio) -- separado en vez de extender ese método para no
   * tocar un contrato ya usado por `getReputationSummary`/tests existentes.
   * `avgPackageWeightKg` es sobre TODOS los envíos del usuario en ese rol, no solo los
   * entregados -- "peso promedio de lo que mueve", no hay ningún AC que pida acotarlo.
   */
  getUsageStatsByRole(userId: string): Promise<{
    asSender: { cancelled: number; avgPackageWeightKg: number | null };
    asCarrier: { cancelled: number; avgPackageWeightKg: number | null };
  }>;
  /**
   * MOVO-170: historial de envíos compartido entre `viewerId` y `otherId`, sin
   * importar en qué rol haya participado cada uno (emisor/receptor/transportista) --
   * un único `count()`/lectura con OR cubriendo las 3 combinaciones posibles entre dos
   * personas. `allDelivered` necesita saber si TODAS las filas son `delivered`, no un
   * conteo, así que trae `status`/`createdAt` en vez de combinar varios `aggregate()`.
   */
  getSharedHistory(
    viewerId: string,
    otherId: string,
  ): Promise<{ sharedShipmentCount: number; lastSharedAt: Date | null; allDelivered: boolean }>;
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
      destinationLat?: number;
      destinationLng?: number;
      radiusKm: number;
      maxDistanceKm?: number;
      excludeUserId: string;
      page: number;
      limit: number;
    }): Promise<{ items: AvailableShipment[]; total: number }> {
      const hasDestination = params.destinationLat !== undefined && params.destinationLng !== undefined;

      // MOVO-142 (fix, corredor de MOVO-50): sin destino, círculo alrededor del origen
      // (AC1 original, "cerca mío"). Con destino, el MISMO rectángulo-corredor para
      // pickup_lat/lng y delivery_lat/lng -- los dos extremos del envío se miden contra
      // el trayecto completo, no cada uno contra un punto distinto (ver
      // `corridorBoundingBox`/`haversineSegmentDistanceKm`).
      const pickupBox = hasDestination
        ? corridorBoundingBox(params.originLat, params.originLng, params.destinationLat!, params.destinationLng!, params.radiusKm)
        : boundingBox(params.originLat, params.originLng, params.radiusKm);
      const deliveryBox = hasDestination ? pickupBox : null;
      const where = availableShipmentsWhereSql({ callerId: params.excludeUserId, pickupBox, deliveryBox });

      // Sin destino: Haversine punto-a-punto contra el origen (círculo). Con destino:
      // distancia perpendicular al segmento origen→destino (corredor) -- ver el
      // comentario de `haversineSegmentDistanceKm` sobre por qué esto reemplazó al AND
      // de dos círculos independientes.
      const pickupDistance = hasDestination
        ? haversineSegmentDistanceKm(params.originLat, params.originLng, params.destinationLat!, params.destinationLng!, Prisma.sql`pickup_lat`, Prisma.sql`pickup_lng`)
        : haversinePointToColumnKm(params.originLat, params.originLng, Prisma.sql`pickup_lat`, Prisma.sql`pickup_lng`);
      // Sin destino, `delivery_distance_km` es NULL -- no hay nada contra qué medir la
      // entrega (AC1 original: el caller no tiene un viaje planificado, solo quiere ver
      // envíos cerca de donde está). `NULL::float8` explícito para que el tipo de
      // columna sea consistente entre las dos ramas del `UNION` implícito de Postgres
      // al resolver el tipo de la expresión.
      const deliveryDistance = hasDestination
        ? haversineSegmentDistanceKm(params.originLat, params.originLng, params.destinationLat!, params.destinationLng!, Prisma.sql`delivery_lat`, Prisma.sql`delivery_lng`)
        : Prisma.sql`NULL::float8`;
      const shipmentDistance = haversineColumnToColumnKm(Prisma.sql`pickup_lat`, Prisma.sql`pickup_lng`, Prisma.sql`delivery_lat`, Prisma.sql`delivery_lng`);

      // AC (refinamiento): tope opcional sobre la distancia PROPIA del envío
      // (pickup→delivery), sin relación con el trayecto del caller -- sin default, si
      // no se manda no filtra por esto.
      const maxDistanceFilter =
        params.maxDistanceKm !== undefined ? Prisma.sql`AND shipment_distance_km <= ${params.maxDistanceKm}` : Prisma.empty;
      // El AND del lado de la entrega solo aplica si el caller mandó destino.
      const deliveryDistanceFilter = hasDestination ? Prisma.sql`AND delivery_distance_km <= ${params.radiusKm}` : Prisma.empty;

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
          SELECT *, (pickup_distance_km + COALESCE(delivery_distance_km, 0)) AS distance_km
          FROM candidates
          WHERE pickup_distance_km <= ${params.radiusKm}
            ${deliveryDistanceFilter}
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
            ${deliveryDistanceFilter}
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

    async findPotentiallyExpiredPublished(limit: number): Promise<Shipment[]> {
      const rows = await db.shipment.findMany({
        where: { status: ShipmentStatus.PUBLISHED },
        take: limit,
        orderBy: [{ pickupDate: "asc" }, { pickupTimeWindowEnd: "asc" }],
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

    async getUsageStatsByRole(userId: string) {
      const [cancelledAsSender, cancelledAsCarrier, avgAsSender, avgAsCarrier] = await Promise.all([
        db.shipment.count({ where: { senderId: userId, status: ShipmentStatus.CANCELLED } }),
        db.shipment.count({ where: { carrierId: userId, status: ShipmentStatus.CANCELLED } }),
        db.shipment.aggregate({ where: { senderId: userId }, _avg: { weightKg: true } }),
        db.shipment.aggregate({ where: { carrierId: userId }, _avg: { weightKg: true } }),
      ]);
      return {
        asSender: {
          cancelled: cancelledAsSender,
          avgPackageWeightKg: avgAsSender._avg.weightKg ? avgAsSender._avg.weightKg.toNumber() : null,
        },
        asCarrier: {
          cancelled: cancelledAsCarrier,
          avgPackageWeightKg: avgAsCarrier._avg.weightKg ? avgAsCarrier._avg.weightKg.toNumber() : null,
        },
      };
    },

    async getSharedHistory(viewerId: string, otherId: string) {
      const rows = await db.shipment.findMany({
        where: {
          OR: [
            { senderId: viewerId, OR: [{ receiverId: otherId }, { carrierId: otherId }] },
            { receiverId: viewerId, OR: [{ senderId: otherId }, { carrierId: otherId }] },
            { carrierId: viewerId, OR: [{ senderId: otherId }, { receiverId: otherId }] },
          ],
        },
        select: { status: true, createdAt: true },
      });
      if (rows.length === 0) {
        return { sharedShipmentCount: 0, lastSharedAt: null, allDelivered: false };
      }
      return {
        sharedShipmentCount: rows.length,
        lastSharedAt: rows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), rows[0].createdAt),
        allDelivered: rows.every((r) => r.status === ShipmentStatus.DELIVERED),
      };
    },
  };
}
