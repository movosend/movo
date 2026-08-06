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
  | "KYC_PROVIDER_ERROR";

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
