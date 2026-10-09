/**
 * Wire contract de la vinculación de la cuenta de Mercado Pago del transportista
 * (MOVO-110). Lo expone `movo-svc-payments` bajo `/payments/mp-connect` (MOVO-111) y lo
 * consume `movo-mobile` (MOVO-112). Fechas como `string` ISO: es el shape ya
 * serializado de la respuesta HTTP.
 */

/**
 * - `linked`: hay una cuenta vinculada y vigente, el transportista puede cobrar.
 * - `unlinked`: nunca vinculó, o desvinculó a mano (`DELETE /payments/mp-connect`).
 * - `invalid`: hubo una cuenta pero dejó de servir (revocada desde MP o token vencido).
 *   Es distinto de `unlinked` a propósito: la app le explica qué pasó y le ofrece
 *   volver a vincular.
 */
export type MpConnectStatus = "linked" | "unlinked" | "invalid";

/**
 * Por qué una vinculación quedó `invalid`. `revoked`: el refresh falló porque el
 * transportista revocó el acceso desde MP (`revoked_at`, MOVO-243). `expired`:
 * `token_expires_at` ya pasó sin renovarse.
 */
export type MpConnectInvalidReason = "revoked" | "expired";

export interface MpConnectAccount {
  mpUserId: string;
  /** De `GET /users/me` de MP con el token del vendedor, después del canje. */
  email: string | null;
  nickname: string | null;
  connectedAt: string;
}

/** `GET /payments/mp-connect/status`. Nunca expone tokens. */
export interface MpConnectStatusResponse {
  status: MpConnectStatus;
  /** `null` solo con `unlinked`: con `invalid` se sigue mostrando qué cuenta era. */
  account: MpConnectAccount | null;
  /** Solo con `invalid`. */
  invalidReason: MpConnectInvalidReason | null;
}

/** `GET /payments/mp-connect/authorization-url`. */
export interface MpConnectAuthorizationUrlResponse {
  authorizationUrl: string;
  /** Vencimiento del `state` (y su `code_verifier` de PKCE) guardado en Redis. */
  expiresAt: string;
}

/**
 * Deep link al que el callback público de OAuth (`GET /payments/mp-connect/callback`)
 * redirige con un 302 al terminar, para que el navegador embebido de la app se cierre
 * solo. Query params:
 * - `?result=success`
 * - `?result=error&code=<MpConnectReturnErrorCode>`
 *
 * La app nunca confía en `result=success`: siempre vuelve a consultar el status.
 */
export const MP_CONNECT_RETURN_URL = "movo://mp-connect";

export type MpConnectReturnResult = "success" | "error";

/** Códigos que el callback manda en el deep link de vuelta (no como respuesta HTTP). */
export type MpConnectReturnErrorCode =
  | "MP_CONNECT_STATE_INVALID"
  | "MP_CONNECT_ACCESS_DENIED"
  | "MP_CONNECT_EXCHANGE_FAILED"
  | "MP_ACCOUNT_ALREADY_LINKED";
