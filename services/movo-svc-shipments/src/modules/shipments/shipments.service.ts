import { ApiError, UserRole } from "@movo/shared";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { UsersClient } from "../../adapters/users-client";
import { PackageType, Shipment } from "../../models/shipment";

export interface CreateShipmentServiceInput {
  senderId: string;
  receiverId: string;
  packageType: PackageType;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description?: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  /** "YYYY-MM-DD" */
  pickupDate: string;
  /** "HH:MM" o "HH:MM:SS" */
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
}

export interface ListMineResult {
  items: Shipment[];
  page: number;
  limit: number;
  total: number;
}

// Fórmula placeholder TEMPORAL: svc-pricing-logistics (motor real, EP-05) todavía es
// solo un esqueleto. Determinística, sin I/O — reemplazar por la llamada real cuando
// exista, sin tocar el resto de este servicio (el contrato de `createShipment` no
// cambia, solo de dónde sale `suggestedPriceArs`).
const BASE_FARE_ARS = 1500;
const PRICE_PER_KG_ARS = 300;
const PRICE_PER_KM_ARS = 150;
const EARTH_RADIUS_KM = 6371;

// MOVO-126: retiro y entrega a menos de 100m se tratan como la misma ubicación —
// umbral chico a propósito (mismo criterio que el rechazo duro de
// SHIPMENT_RECEIVER_IS_SENDER, un caso que nunca tiene sentido de negocio), no
// pensado para descartar casos legítimos como "de mi depto a la portería del mismo
// edificio".
const MIN_PICKUP_DELIVERY_DISTANCE_KM = 0.1;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computePlaceholderPrice(weightKg: number, distanceKm: number): number {
  return Math.round(BASE_FARE_ARS + weightKg * PRICE_PER_KG_ARS + distanceKm * PRICE_PER_KM_ARS);
}

/** "HH:MM" -> "HH:MM:00"; "HH:MM:SS" queda igual. */
function normalizeTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

/** Fecha+hora real (para comparar contra "ahora" y validar la franja). */
function combineDateAndTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${normalizeTime(timeStr)}.000Z`);
}

// La app opera solo en Argentina (mismo criterio que el regex de teléfono/país
// hardcodeado en address) — sin DST, por lo que el offset es constante.
const ARGENTINA_UTC_OFFSET_HOURS = 3;

/**
 * `combineDateAndTime` ancla el valor de calendario/reloj de pared (hora local
 * argentina) como si fuera UTC -- correcto para persistir (ver `toEpochTime`/nota de
 * MOVO-80 en CLAUDE.md), pero incorrecto para comparar contra un instante real como
 * `new Date()`. Sin este ajuste, "está en el pasado" queda desfasado exactamente el
 * offset de Argentina (UTC-3): un horario todavía futuro en hora local argentina
 * podía rechazarse como pasado. Convierte el valor anclado al instante UTC real que
 * representa esa hora de pared en Argentina.
 */
function toRealInstant(anchoredDate: Date): Date {
  return new Date(anchoredDate.getTime() + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

/** Hora sobre la fecha epoch 1970-01-01 — mismo formato que ya usan las columnas
 * `@db.Time` del repositorio (ver shipment-repository.integration.test.ts). */
function toEpochTime(timeStr: string): Date {
  return new Date(`1970-01-01T${normalizeTime(timeStr)}.000Z`);
}

export function createShipmentsService(repository: ShipmentRepository, usersClient: UsersClient) {
  return {
    async createShipment(input: CreateShipmentServiceInput): Promise<Shipment> {
      // AC4 — auto-designación, primero por ser el chequeo más barato (sin I/O).
      if (input.senderId === input.receiverId) {
        throw new ApiError(422, "SHIPMENT_RECEIVER_IS_SENDER", "No podés designarte a vos mismo como receptor.");
      }

      // MOVO-126 — retiro y entrega no pueden ser la misma ubicación, todavía sin I/O.
      // El resultado se reusa más abajo para el precio sugerido, no se recalcula.
      const pickupDeliveryDistanceKm = haversineKm(
        input.pickupLat,
        input.pickupLng,
        input.deliveryLat,
        input.deliveryLng
      );
      if (pickupDeliveryDistanceKm < MIN_PICKUP_DELIVERY_DISTANCE_KM) {
        throw new ApiError(
          422,
          "SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE",
          "El retiro y la entrega tienen que estar en ubicaciones distintas."
        );
      }

      // AC6 — validación de fecha/franja, todavía sin I/O.
      const windowStartAt = combineDateAndTime(input.pickupDate, input.pickupTimeWindowStart);
      const windowEndAt = combineDateAndTime(input.pickupDate, input.pickupTimeWindowEnd);
      if (windowEndAt <= windowStartAt) {
        throw new ApiError(
          422,
          "SHIPMENT_PICKUP_WINDOW_INVALID",
          "El fin de la franja de retiro debe ser posterior al inicio."
        );
      }
      if (toRealInstant(windowStartAt) < new Date()) {
        throw new ApiError(422, "SHIPMENT_PICKUP_WINDOW_IN_PAST", "La franja de retiro no puede estar en el pasado.");
      }

      // AC5 — el receptor tiene que existir y tener KYC de identidad aprobado.
      // `PublicProfile.isVerified` ya es exactamente `kycStatusIdentity === APPROVED`
      // del lado de svc-users (models/user-profile.ts#toPublicProfile).
      const receiverProfile = await usersClient.findPublicProfile(input.receiverId, input.senderId);
      if (!receiverProfile) {
        throw new ApiError(404, "USER_NOT_FOUND", "El receptor indicado no existe.");
      }
      if (!receiverProfile.isVerified) {
        throw new ApiError(
          422,
          "SHIPMENT_RECEIVER_KYC_NOT_APPROVED",
          "El receptor todavía no tiene su identidad verificada."
        );
      }

      const suggestedPriceArs = computePlaceholderPrice(input.weightKg, pickupDeliveryDistanceKm);

      return repository.create({
        senderId: input.senderId,
        receiverId: input.receiverId,
        packageType: input.packageType,
        weightKg: input.weightKg,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        description: input.description,
        pickupAddress: input.pickupAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        deliveryAddress: input.deliveryAddress,
        deliveryLat: input.deliveryLat,
        deliveryLng: input.deliveryLng,
        pickupDate: new Date(`${input.pickupDate}T00:00:00.000Z`),
        pickupTimeWindowStart: toEpochTime(input.pickupTimeWindowStart),
        pickupTimeWindowEnd: toEpochTime(input.pickupTimeWindowEnd),
        suggestedPriceArs,
      });
    },

    async getShipmentDetail(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<Shipment> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      const isParty = callerId === shipment.senderId || callerId === shipment.receiverId;
      const isAdmin = callerRoles.includes(UserRole.ADMIN);
      if (!isParty && !isAdmin) {
        // AC8: 403 explícito, nunca 404 "filtrado" — el id es un UUID no adivinable,
        // mismo criterio ya aceptado para PHOTO_FORBIDDEN_KEY en MOVO-97.
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver este envío.");
      }
      return shipment;
    },

    async listMyShipments(userId: string, page: number, limit: number): Promise<ListMineResult> {
      const { items, total } = await repository.listByUser(userId, page, limit);
      return { items, page, limit, total };
    },
  };
}
