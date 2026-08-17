import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
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

export const shipmentsClient = {
  /** Protegida — `httpClient` adjunta `Authorization` automáticamente vía el
   * interceptor de sesión (MOVO-76). */
  listMine(params?: { page?: number; limit?: number }): Promise<ListMineResponse> {
    return httpClient.get<ListMineResponse>("/shipments/mine", params);
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
};
