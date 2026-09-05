import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { PackageType } from "../store/shipment-wizard-store";
import { httpClient } from "./http-client";

/**
 * DTO tal cual lo devuelve `GET /shipments/mine` (`shipmentResponse` en
 * `shipments.schema.ts`, `movo-svc-shipments`, MOVO-80). `pickupDate`/
 * `pickupTimeWindowStart`/`pickupTimeWindowEnd` ya vienen como string formateado
 * (no ISO datetime completo) — ver el fix de timezone documentado en CLAUDE.md, MOVO-80.
 */
export interface ShipmentSummary {
  id: string;
  senderId: string;
  receiverId: string;
  carrierId: string | null;
  packageType: "letter_document" | "standard_package" | "fragile_item";
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description: string | null;
  urgent: boolean;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  suggestedPriceArs: number;
  agreedPriceArs: number | null;
  paymentMethod: string | null;
  status: ShipmentStatus;
  lastStatusChangedAt: string | null;
  deliveredAt: string | null;
  receiverConfirmationDeadline?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListMineResponse {
  items: ShipmentSummary[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Body de `POST /shipments` (`createShipmentBody` en `shipments.schema.ts`,
 * `movo-svc-shipments`, MOVO-80) — `additionalProperties: false` en el backend, nunca
 * mandar `senderId` (viaja en el header `x-user-id` inyectado por el gateway).
 */
export interface CreateShipmentInput {
  packageType: "letter_document" | "standard_package" | "fragile_item";
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description?: string;
  receiverId: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
}

/** Respuesta de `GET /shipments/route` (`routeResponse` en `shipments.schema.ts`,
 * `movo-svc-shipments`, MOVO-123) — polyline codificado (algoritmo estándar de
 * Google), consumido por `RouteMapCard` del paso de resumen del wizard. */
export interface RouteResult {
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
}

/** Único stage soportado por el contrato hoy (`presignPhotoBody`/`confirmPhotoBody`
 * en `shipments.schema.ts`, MOVO-81) — pickup/delivery quedan para MOVO-21. */
export type ShipmentPhotoStage = "creation";

/** Body de `POST /shipments/:id/photos/presign` (MOVO-81) — `contentType`/
 * `contentLength` quedan firmados dentro de la presigned URL (no solo validados), el
 * cliente tiene que subir exactamente ese tipo/tamaño o S3 rechaza la firma. */
export interface PresignShipmentPhotoInput {
  stage: ShipmentPhotoStage;
  contentType: "image/jpeg";
  contentLength: number;
}

export interface PresignShipmentPhotoResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export interface ConfirmShipmentPhotoInput {
  s3Key: string;
  stage: ShipmentPhotoStage;
}

export interface ConfirmShipmentPhotoResponse {
  id: string;
  stage: ShipmentPhotoStage;
  createdAt: string;
}

/** Item de `GET /shipments/:id/photos` (`listPhotosResponse` en `shipments.schema.ts`,
 * MOVO-81) — `url` es una presigned GET de TTL corto, nunca cachear más allá de
 * `expiresIn`. */
export interface ShipmentPhoto {
  id: string;
  stage: ShipmentPhotoStage;
  url: string;
  expiresIn: number;
  createdAt: string;
}

/** Item de `GET /shipments/:id/events` (`shipmentEventResponse` en
 * `shipments.schema.ts`, MOVO-128) — historial de cambios de estado en orden
 * cronológico ascendente. `fromStatus` es `null` solo en el evento de creación;
 * `actorId` es un UUID crudo (el backend no cruza a `users.users`, ADR-003) y puede
 * ser `null` si la transición no la disparó una persona. */
export interface ShipmentEvent {
  id: string;
  shipmentId: string;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * DTO de `GET /shipments/available` (`availableShipmentResponse` en
 * `shipments.schema.ts`, `movo-svc-shipments`, MOVO-142) — proyección deliberadamente
 * más chica que `ShipmentSummary` (sin `senderId`/`carrierId`/`agreedPriceArs`/etc.,
 * ver el comentario del propio schema del backend): un transportista que todavía no
 * tiene el envío asignado no debería ver esos datos. `deliveryDistanceKm` es `null`
 * si el caller no mandó destino (modo "solo cerca mío", sin viaje planificado).
 */
export interface AvailableShipment {
  id: string;
  packageType: PackageType;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description: string | null;
  urgent: boolean;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  suggestedPriceArs: number | null;
  calculationMethod: string | null;
  status: ShipmentStatus;
  pickupDistanceKm: number;
  deliveryDistanceKm: number | null;
  distanceKm: number;
  hasMyOffer: boolean;
  createdAt: string;
}

/** `destinationLat`/`destinationLng` viajan juntos o ninguno (400 del backend si se
 * manda solo uno, MOVO-142) — no expresable en el tipo sin un union incómodo para los
 * callers, se documenta acá en vez de en el schema del request. */
export interface ListAvailableParams {
  originLat: number;
  originLng: number;
  destinationLat?: number;
  destinationLng?: number;
  radiusKm?: number;
  maxDistanceKm?: number;
  page?: number;
  limit?: number;
}

export interface ListAvailableResponse {
  items: AvailableShipment[];
  page: number;
  limit: number;
  total: number;
}

export const shipmentsClient = {
  /** Protegida — `httpClient` adjunta `Authorization` automáticamente vía el
   * interceptor de sesión (MOVO-76). */
  listMine(params?: { page?: number; limit?: number }): Promise<ListMineResponse> {
    return httpClient.get<ListMineResponse>("/shipments/mine", params);
  },

  /** `GET /shipments/available` (MOVO-142) — descubrimiento por radio geográfico (y
   * opcionalmente por corredor origen→destino) para el tab "Transportar" (MOVO-148).
   * Requiere rol `carrier` + KYC de identidad aprobado (403 `CARRIER_NOT_VERIFIED`
   * si no, nunca por falta de licencia de conducir). */
  listAvailable(params: ListAvailableParams): Promise<ListAvailableResponse> {
    return httpClient.get<ListAvailableResponse>("/shipments/available", {
      originLat: params.originLat,
      originLng: params.originLng,
      destinationLat: params.destinationLat,
      destinationLng: params.destinationLng,
      radiusKm: params.radiusKm,
      maxDistanceKm: params.maxDistanceKm,
      page: params.page,
      limit: params.limit,
    });
  },

  create(body: CreateShipmentInput): Promise<ShipmentSummary> {
    return httpClient.post<ShipmentSummary>("/shipments", body);
  },

  getRoute(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }): Promise<RouteResult> {
    return httpClient.get<RouteResult>("/shipments/route", {
      originLat: origin.lat,
      originLng: origin.lng,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
    });
  },

  /** `GET /shipments/:id` (MOVO-80) — 403 si el envío es de otro usuario, nunca 404
   * filtrado (el backend distingue "no existe" de "no es tuyo"). */
  getById(id: string): Promise<ShipmentSummary> {
    return httpClient.get<ShipmentSummary>(`/shipments/${id}`);
  },

  /** `POST /shipments/:id/photos/presign` (MOVO-81) — solo el emisor puede pedirla. */
  presignPhoto(shipmentId: string, body: PresignShipmentPhotoInput): Promise<PresignShipmentPhotoResponse> {
    return httpClient.post<PresignShipmentPhotoResponse>(`/shipments/${shipmentId}/photos/presign`, body);
  },

  /** `POST /shipments/:id/photos/confirm` (MOVO-81) — el backend valida contra S3
   * (HEAD real) antes de registrar la foto. */
  confirmPhoto(shipmentId: string, body: ConfirmShipmentPhotoInput): Promise<ConfirmShipmentPhotoResponse> {
    return httpClient.post<ConfirmShipmentPhotoResponse>(`/shipments/${shipmentId}/photos/confirm`, body);
  },

  /** `GET /shipments/:id/photos` (MOVO-81) — mismo criterio de acceso que `getById`
   * (403 ajeno, 404 inexistente). Consumida por la card de paquete del detalle de
   * envío (MOVO-127). */
  listPhotos(shipmentId: string): Promise<ShipmentPhoto[]> {
    return httpClient.get<ShipmentPhoto[]>(`/shipments/${shipmentId}/photos`);
  },

  /** `GET /shipments/:id/events` (MOVO-128) — mismo criterio de acceso que `getById`
   * (403 ajeno, 404 inexistente). Consumida por la línea de tiempo del detalle de
   * envío (MOVO-127). Sin paginación: el historial de un envío es acotado por
   * definición (una entrada por transición de estado). */
  listEvents(shipmentId: string): Promise<ShipmentEvent[]> {
    return httpClient.get<ShipmentEvent[]>(`/shipments/${shipmentId}/events`);
  },

  /** `POST /shipments/:id/accept` (MOVO-129 / MOVO-131) — solo el receptor designado
   * puede llamar a este endpoint en estado `awaiting_receiver_confirmation`. */
  accept(shipmentId: string): Promise<ShipmentSummary> {
    return httpClient.post<ShipmentSummary>(`/shipments/${shipmentId}/accept`, {});
  },

  /** `POST /shipments/:id/reject` (MOVO-129 / MOVO-131) — solo el receptor designado
   * puede llamar a este endpoint en estado `awaiting_receiver_confirmation`. */
  reject(shipmentId: string, body?: { reason?: string }): Promise<ShipmentSummary> {
    return httpClient.post<ShipmentSummary>(`/shipments/${shipmentId}/reject`, body ?? {});
  },

  /** `POST /shipments/:id/cancel` (MOVO-29, implementado en MOVO-108) — solo el
   * emisor puede llamar a este endpoint, desde `awaiting_receiver_confirmation`,
   * `published` o `assignment_pending`. */
  cancel(shipmentId: string, body?: { reason?: string }): Promise<ShipmentSummary> {
    return httpClient.post<ShipmentSummary>(`/shipments/${shipmentId}/cancel`, body ?? {});
  },

  /** `GET /shipments/history-with/:userId` (MOVO-170, todavía sin implementar en
   * `svc-shipments` — ver esa issue para el contrato propuesto). Historial
   * compartido entre el usuario autenticado y `userId`, para el rediseño de
   * perfil. */
  getHistoryWith(userId: string): Promise<SharedHistory> {
    return httpClient.get<SharedHistory>(`/shipments/history-with/${userId}`);
  },
};

/** MOVO-170, todavía sin backend. */
export interface SharedHistory {
  sharedShipmentCount: number;
  lastSharedAt: string | null;
  allDelivered: boolean;
}
