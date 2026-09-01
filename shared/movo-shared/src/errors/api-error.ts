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
  | "ROUTES_PROVIDER_ERROR"
  | "ROUTE_NOT_FOUND"
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
  | "TRIP_NOT_FOUND"
  | "TRIP_HAS_ACCEPTED_PACKAGES"
  | "TRIP_ORIGIN_DESTINATION_TOO_CLOSE"
  | "TRIP_DEPARTURE_IN_PAST"
  | "SHIPMENT_NOT_AVAILABLE_FOR_OFFER"
  | "OFFER_DATE_OUT_OF_RANGE"
  | "OFFER_DUPLICATE_ACTIVE";

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
