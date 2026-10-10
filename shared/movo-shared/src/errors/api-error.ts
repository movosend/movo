/**
 * Código de error estable de la API. Es un contrato de wire: nunca se
 * renombra ni se elimina un valor existente, solo se agregan nuevos.
 */
export type ApiErrorCode =
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_FORBIDDEN"
  | "ACCOUNT_SUSPENDED"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR"
  | "USER_EMAIL_ALREADY_EXISTS"
  | "USER_PHONE_ALREADY_EXISTS"
  | "AUTH_OTP_INVALID"
  | "AUTH_OTP_EXPIRED"
  | "KYC_SESSION_NOT_ALLOWED"
  | "KYC_WEBHOOK_INVALID_SIGNATURE"
  | "KYC_PROVIDER_ERROR"
  | "AUTH_REFRESH_INVALID"
  | "GEOCODING_PROVIDER_ERROR"
  | "GEOCODING_ADDRESS_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "STORAGE_PROVIDER_ERROR"
  | "PHOTO_OBJECT_NOT_FOUND"
  | "PHOTO_FORBIDDEN_KEY"
  | "SHIPMENT_RECEIVER_IS_SENDER"
  | "SHIPMENT_RECEIVER_KYC_NOT_APPROVED"
  | "SHIPMENT_PICKUP_WINDOW_IN_PAST"
  | "SHIPMENT_PICKUP_WINDOW_INVALID"
  | "SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE"
  | "USERS_SERVICE_UNAVAILABLE"
  | "PUSH_PROVIDER_ERROR"
  | "ADDRESS_NOT_FOUND"
  | "PLACES_PROVIDER_ERROR"
  | "PLACE_NOT_FOUND"
  | "SHIPMENT_INSUFFICIENT_CREATION_PHOTOS"
  | "SHIPMENT_INVALID_TRANSITION"
  | "SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED"
  // MOVO-253: venció el plazo para elegir otro receptor tras un rechazo.
  | "SHIPMENT_REDESIGNATION_EXPIRED"
  // MOVO-253: el receptor elegido ya rechazó este mismo envío.
  | "SHIPMENT_RECEIVER_ALREADY_REJECTED"
  | "ROUTES_PROVIDER_ERROR"
  | "ROUTE_NOT_FOUND"
  // MOVO-237: modo `live` del RoutesProvider, placeholder intencional (ADR-033).
  | "ROUTE_MODE_NOT_IMPLEMENTED"
  | "PROFILE_NAME_LOCKED_BY_KYC"
  | "PHONE_ALREADY_IN_USE"
  | "EMAIL_ALREADY_IN_USE"
  | "ACCOUNT_HAS_ACTIVE_DISPUTES"
  | "ACCOUNT_HAS_ACTIVE_SHIPMENTS"
  | "SHIPMENTS_SERVICE_UNAVAILABLE"
  | "SHIPMENT_CONCURRENT_MODIFICATION"
  | "SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED"
  | "ACCOUNT_DELETION_IN_PROGRESS"
  | "PHOTO_CONFIRMATION_IN_PROGRESS"
  | "OFFER_NOT_FOUND"
  | "SHIPMENT_NOT_AVAILABLE_FOR_ASSIGNMENT"
  | "OFFER_CONCURRENT_MODIFICATION"
  | "OFFER_INVALID_TRANSITION"
  | "SHIPMENT_NOT_DELIVERED"
  | "SHIPMENT_RATING_DISPUTE_ACTIVE"
  | "SHIPMENT_RATING_WINDOW_EXPIRED"
  | "SHIPMENT_RATING_ALREADY_EXISTS"
  | "SHIPMENT_RATING_NOT_FOUND"
  | "CARRIER_NOT_VERIFIED"
  | "DEVICE_KEY_NOT_FOUND"
  | "TRIP_NOT_FOUND"
  | "TRIP_HAS_ACCEPTED_PACKAGES"
  | "TRIP_ORIGIN_DESTINATION_TOO_CLOSE"
  | "TRIP_DEPARTURE_IN_PAST"
  // MOVO-221: código histórico de MOVO-162, dejado de usar al ampliar el chequeo de
  // `createOfferForShipment` para aceptar tripId de un viaje `declared` (antes exigía
  // `active` a secas) -- nunca se elimina un valor del contrato de wire, ver el
  // comentario de arriba. Reemplazado por `TRIP_NOT_AVAILABLE`.
  | "TRIP_NOT_ACTIVE"
  | "SHIPMENT_NOT_AVAILABLE_FOR_OFFER"
  | "OFFER_DATE_OUT_OF_RANGE"
  | "OFFER_DUPLICATE_ACTIVE"
  | "OFFER_PICKUP_WINDOW_INVALID"
  | "OFFER_NOT_EDITABLE"
  | "HANDSHAKE_QR_EXPIRED"
  | "HANDSHAKE_DISTANCE_EXCEEDED"
  | "HANDSHAKE_INVALID_SIGNATURE"
  | "HANDSHAKE_CEDENTE_KEY_MISSING"
  | "HANDSHAKE_INVALID_SHIPMENT_STATE"
  | "ROUTING_SERVICE_ERROR"
  | "ROUTING_SERVICE_UNAVAILABLE"
  // MOVO-221 / MOVO-252: rediseño de estados de viaje (declared/active/completed).
  | "TRIP_NOT_DECLARED"
  | "TRIP_ALREADY_HAS_ACTIVE_TRIP"
  | "TRIP_NOT_AVAILABLE"
  // MOVO-258 (D5): `POST /trips/:id/start` sobre un viaje sin ningún paquete aceptado --
  // los paquetes quedan fijos al iniciar, así que no se puede arrancar uno vacío.
  | "TRIP_NO_PACKAGES"
  // MOVO-228: la app mandó una versión de Términos/Privacidad distinta a la vigente
  // (`LEGAL_DOCUMENT_VERSIONS`, config/legal.ts) -- app desactualizada, el usuario
  // tiene que revisar y aceptar el contenido actual antes de poder registrarse.
  | "LEGAL_DOCUMENT_VERSION_MISMATCH"
  // MOVO-196: al confirmar el handshake de retiro/entrega sin al menos una foto
  // CONFIRMADA (`shipment_photos`, no solo un presign emitido) de la etapa correspondiente.
  | "PICKUP_EVIDENCE_MISSING"
  | "DELIVERY_EVIDENCE_MISSING"
  // MOVO-196: al confirmar una foto de evidencia (`pickup`/`delivery`) que superaría
  // el máximo permitido por etapa (`MAX_EVIDENCE_PHOTOS_PER_STAGE`).
  | "PHOTO_STAGE_LIMIT_EXCEEDED"
  // MOVO-202: reportar una posición GPS sobre un envío que no está `in_transit` --
  // AC2 del ticket lo trata como 403, no 409 (mismo status que un actor equivocado,
  // aunque el problema sea de estado y no de autorización).
  | "SHIPMENT_NOT_IN_TRANSIT"
  // MOVO-251: el envío no está en un viaje activo (o ya cerró su ciclo) para reportar o leer tracking.
  | "SHIPMENT_NOT_TRACKABLE"
  // MOVO-250: `capturedAt` de una posición GPS en el futuro (más allá de la tolerancia de
  // desfase de reloj) o anterior a que el envío pasara a `in_transit`.
  | "INVALID_CAPTURED_AT"
  // MOVO-175: interacción (oferta, aceptación, envío como receptor) entre dos usuarios
  // con un bloqueo en cualquier dirección -- explícito a propósito (ADR-026).
  | "USER_BLOCKED"
  // MOVO-175: reportarse o bloquearse a uno mismo.
  | "CANNOT_MODERATE_SELF"
  // MOVO-175: ya hay un reporte propio en revisión sobre ese usuario -- se suma
  // información con `POST /users/:id/report/entries` en vez de crear otro.
  | "REPORT_ALREADY_PENDING"
  // MOVO-256: la foto ya está asociada a otro envío del reporte (o al mismo, reintento).
  | "REPORT_PHOTO_ALREADY_USED"
  // MOVO-175: sumar información sin un reporte propio en revisión sobre ese usuario.
  | "REPORT_NOT_FOUND"
  // MOVO-255: el `quoteId` mandado al crear el envío no existe, venció, ya se usó o es
  // de otro usuario -- el cliente vuelve a cotizar y pide confirmación de nuevo.
  | "QUOTE_EXPIRED"
  // MOVO-255: los datos que afectan el precio cambiaron después de cotizar.
  | "QUOTE_MISMATCH"
  // Juego de precios de la feria (módulo demo de svc-shipments + API key en el gateway)
  | "AUTH_API_KEY_INVALID"
  | "PRICING_UNAVAILABLE"
  // Juego del optimizador: partida vencida en Redis y sin los números offline del iPad.
  | "ROUTE_GAME_NOT_FOUND"
  // MOVO-111/112: vinculación de la cuenta de Mercado Pago del transportista.
  // Faltan las credenciales `MP_*` de la app en el ambiente (503 en authorization-url).
  | "MP_CONNECT_NOT_CONFIGURED"
  // Los cuatro siguientes viajan en el deep link de vuelta del callback de OAuth
  // (`MpConnectReturnErrorCode`, types/mp-connect.ts), no como respuesta HTTP.
  // `state` vencido, ya usado o inexistente.
  | "MP_CONNECT_STATE_INVALID"
  // El transportista rechazó la autorización en Mercado Pago.
  | "MP_CONNECT_ACCESS_DENIED"
  // Falló el canje del code (`/oauth/token`) o la consulta de la cuenta (`/users/me`).
  | "MP_CONNECT_EXCHANGE_FAILED"
  // Esa cuenta de MP ya está vinculada a otro usuario de Movo.
  | "MP_ACCOUNT_ALREADY_LINKED"
  // MOVO-209: endpoints internos de holds de `svc-payments`.
  // El transportista no tiene una cuenta de MP vigente (nunca vinculó, desvinculó,
  // revocó o el token venció): sin ella no hay `public_key` ni access_token para cobrar.
  | "CARRIER_MP_ACCOUNT_NOT_LINKED"
  // El envío no tiene ningún hold (ni siquiera un intento rechazado).
  | "HOLD_NOT_FOUND"
  // Liberar un hold que ya no se puede liberar (capturado) o que todavía no está creado.
  | "HOLD_NOT_RELEASABLE"
  // Ya hay un hold vigente del envío con otro transportista o monto: no se pisa en silencio.
  | "HOLD_CONFLICT"
  // Mercado Pago no respondió o devolvió un error que no es un rechazo de la tarjeta
  // (5xx, timeout, red). El hold queda reintentable con la misma idempotency key.
  | "PAYMENT_PROVIDER_ERROR";

/** Forma resultante de `ApiError.toJSON()` — el formato único de error que la API expone. */
export interface SerializedApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    statusCode: number;
  };
}

/** Formato único de error de la API. No contiene lógica de negocio. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Serializa al formato único de error de la API. */
  toJSON(): SerializedApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
      },
    };
  }
}
