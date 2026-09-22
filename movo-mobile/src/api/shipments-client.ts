import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { CarrierRoute } from "@movo/shared/dist/types/routing";
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
  /** MOVO-180 (adelantado): solo presente en `GET /shipments/:id` cuando el caller es
   * un transportista ajeno viendo un envío `published` — agregado de ofertas vigentes
   * sin identidad de los competidores, `null` si no hay ninguna. */
  offersSummary?: { count: number; minPriceNetArs: number } | null;
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

/** Stages soportados por `presignPhotoBody`/`confirmPhotoBody` (`shipments.schema.ts`).
 * `creation` lo registra el emisor durante el alta del envío (MOVO-81); `pickup`/
 * `delivery` los registra el transportista asignado, exigidos por el handshake de
 * MOVO-196 antes de poder confirmarlo (MOVO-197/198/199). */
export type ShipmentPhotoStage = "creation" | "pickup" | "delivery";

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

/** `GET /shipments/:id/evidence-status` (`evidenceStatusResponse` en
 * `shipments.schema.ts`, MOVO-196 AC6) — `stage` lo infiere el backend del
 * `shipment.status` actual (`assigned` → `pickup`, `in_transit` → `delivery`,
 * cualquier otro → `null` con `satisfied: true`/`photoCount: 0`). `minRequired`/
 * `maxAllowed` viajan siempre, incluso con `stage: null` — el cliente nunca los
 * hardcodea (MOVO-197 AC5/AC6). */
export interface EvidenceStatus {
  stage: "pickup" | "delivery" | null;
  satisfied: boolean;
  photoCount: number;
  minRequired: number;
  maxAllowed: number;
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

/**
 * DTO propuesto para `GET /shipments/sending` / `GET /shipments/transporting` /
 * `GET /shipments/receiving` (MOVO-192, todavía sin implementar en `movo-svc-shipments`
 * — Todo, bloqueante de MOVO-193). Contrato comentado en el ticket de Linear antes de
 * que se codee: camelCase (consistente con `ShipmentSummary`, a diferencia del
 * snake_case en que está redactado el AC del ticket) y **sin** ningún campo de
 * ETA/proximidad — esa señal es tracking en vivo (MOVO-203/MOVO-11), sin empezar y
 * fuera del AC4/AC6 de MOVO-192. `status` es el subconjunto "activo" que define el
 * AC4 de MOVO-192 (incluye `assigned_unfunded`, agregado por MOVO-208, también Todo).
 * `isToday`/`pickupWindowExpired` los calcula el backend (AC6), nunca el cliente.
 */
export interface ActiveShipmentSummary {
  id: string;
  status: "assigned_unfunded" | "assigned" | "in_transit";
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  pickupAddress: string;
  deliveryAddress: string;
  agreedPriceArs: number;
  counterparty: { name: string; initials: string };
  isToday: boolean;
  pickupWindowExpired: boolean;
}

/**
 * `POST /shipments/:id/handshake/generate` (`handshake.schema.ts`, MOVO-158, Done) —
 * lo llama el CEDENTE de la custodia (emisor en el retiro, transportista en la
 * entrega). Agregado ahora como harness de prueba de MOVO-160 (`/dev-handshake`,
 * sin backend real de generación de QR todavía del lado de la UI) — `MOVO-159` va a
 * reusar este mismo método para su pantalla real, no hace falta que lo reescriba.
 */
export interface GenerateHandshakeResult {
  shipmentId: string;
  stage: "pickup" | "delivery";
  nonce: string;
  canonicalPayload: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Body de `POST /shipments/:id/handshake/confirm` (`confirmHandshakeBody` en
 * `handshake.schema.ts`, `movo-svc-shipments`, MOVO-158, Done). Lo llama quien
 * **recibe** la custodia (MOVO-160) — `nonce`/`signature` salen tal cual del QR
 * escaneado (generado y firmado del lado del cedente, MOVO-159/MOVO-195); este lado
 * nunca firma nada, solo agrega sus propias coordenadas GPS.
 */
export interface ConfirmHandshakeInput {
  nonce: string;
  signature: string;
  lat: number;
  lng: number;
}

/** `confirmHandshakeResponse` (`handshake.schema.ts`). */
export interface ConfirmHandshakeResult {
  shipmentId: string;
  stage: "pickup" | "delivery";
  previousStatus: ShipmentStatus;
  status: ShipmentStatus;
  distanceM: number;
  confirmedAt: string;
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

  /** `GET /shipments/:id/evidence-status` (MOVO-196 AC6) — accesible para emisor,
   * receptor, transportista asignado o admin. Consumida por el step reusable de
   * evidencia (MOVO-197) y por los wizards de retiro/entrega (MOVO-198/199) para
   * gatear la navegación sin intentar el handshake y fallar. */
  getEvidenceStatus(shipmentId: string): Promise<EvidenceStatus> {
    return httpClient.get<EvidenceStatus>(`/shipments/${shipmentId}/evidence-status`);
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

  /** `GET /shipments/sending` (MOVO-192, todavía sin backend — ver `ActiveShipmentSummary`).
   * Envíos activos donde el usuario autenticado es el emisor, para la sección "Estoy
   * enviando" del home operativo (MOVO-193). */
  getSending(): Promise<ActiveShipmentSummary[]> {
    return httpClient.get<ActiveShipmentSummary[]>("/shipments/sending");
  },

  /** `GET /shipments/receiving` (MOVO-192, todavía sin backend — ver
   * `ActiveShipmentSummary`). Envíos activos donde el usuario autenticado es el
   * receptor, para la sección "Voy a recibir" del home operativo (MOVO-193). */
  getReceiving(): Promise<ActiveShipmentSummary[]> {
    return httpClient.get<ActiveShipmentSummary[]>("/shipments/receiving");
  },

  /** `GET /shipments/history-with/:userId` (MOVO-170, todavía sin implementar en
   * `svc-shipments` — ver esa issue para el contrato propuesto). Historial
   * compartido entre el usuario autenticado y `userId`, para el rediseño de
   * perfil. */
  getHistoryWith(userId: string): Promise<SharedHistory> {
    return httpClient.get<SharedHistory>(`/shipments/history-with/${userId}`);
  },

  /** `GET /shipments/my-route?lat=...&lng=...` (MOVO-206 / MOVO-207 / MOVO-235).
   * Ruta optimizada multi-parada del transportista autenticado con solver VRPTW.
   * Acepta opcionalmente `tripId` para acotar la ruta al viaje iniciado (MOVO-235). */
  getMyRoute(coords: { lat: number; lng: number }, tripId?: string): Promise<CarrierRoute> {
    return httpClient.get<CarrierRoute>("/shipments/my-route", {
      lat: coords.lat,
      lng: coords.lng,
      tripId,
    });
  },

  /**
   * `POST /shipments/:id/handshake/generate` (MOVO-158 / MOVO-159).
   * Genera el nonce y payload canónico para el handshake de custodia del cedente
   * (emisor en retiro, transportista en entrega). Requiere las coordenadas GPS actuales.
   */
  generateHandshake(
    shipmentId: string,
    input: GenerateHandshakeInput,
  ): Promise<GenerateHandshakeResult> {
    return httpClient.post<GenerateHandshakeResult>(
      `/shipments/${shipmentId}/handshake/generate`,
      input,
    );
  },

  /** `POST /shipments/:id/handshake/confirm` (MOVO-158, Done) — MOVO-160. */
  confirmHandshake(shipmentId: string, input: ConfirmHandshakeInput): Promise<ConfirmHandshakeResult> {
    return httpClient.post<ConfirmHandshakeResult>(`/shipments/${shipmentId}/handshake/confirm`, input);
  },
};

export type { CarrierRoute };

/** Input para `POST /shipments/:id/handshake/generate`. */
export interface GenerateHandshakeInput {
  lat: number;
  lng: number;
}

/**
 * Respuesta de `POST /shipments/:id/handshake/generate` (MOVO-158 / MOVO-159).
 * El cliente firma `canonicalPayload` con `signHandshakeNonce()` y ensambla el QR
 * con `{ shipmentId, nonce, signature }`.
 */
export interface GenerateHandshakeResult {
  shipmentId: string;
  stage: "pickup" | "delivery";
  nonce: string;
  canonicalPayload: string;
  expiresAt: string;
  ttlSeconds: number;
}

/** MOVO-170, todavía sin backend. */
export interface SharedHistory {
  sharedShipmentCount: number;
  lastSharedAt: string | null;
  allDelivered: boolean;
}
