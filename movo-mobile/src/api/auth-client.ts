import type { KycStatus } from "@movo/shared/dist/types/user";
import { httpClient } from "./http-client";
import type { SessionResponse } from "./session-types";

/**
 * Contrato de `movo-svc-users` (MOVO-70/71/72/73). `POST /auth/register` pasó a
 * emitir tokens de sesión (mismo shape que `login`) — PR #51 de MOVO-72 — así que el
 * registro ya autentica, no hace falta un login separado antes de KYC. Como
 * consecuencia, `POST /kyc/session` y `GET /kyc/status` dejaron de ser públicas: ahora
 * exigen `Authorization: Bearer <accessToken>` (el gateway saca el userId del JWT, ya
 * no de un parámetro explícito) — ver `createKycSession`/`getKycStatus` abajo.
 */

export interface RegisterAddress {
  street: string;
  number: string;
  floor?: string;
  city: string;
  province: string;
  zip: string;
  /** Confirmados por el paso de mapa/geocoding del wizard (MOVO-73) — ver `geocodeAddress`. */
  lat: number;
  long: number;
}

export interface RegisterRequest {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  dni: string;
  address: RegisterAddress;
  /** Prueba de que `phone` ya pasó el OTP — ver `verifyOtp`. */
  phoneVerificationToken: string;
}

/** Mismo shape que `LoginResponse` — register() autentica igual que login() (PR #51). */
export type RegisterResponse = SessionResponse;

export interface SendOtpResponse {
  otpId: string;
  cooldownSeconds: number;
}

export interface VerifyOtpRequest {
  otpId: string;
  code: string;
}

export interface VerifyOtpResponse {
  phoneVerificationToken: string;
  phoneVerifiedAt: string;
}

export interface ResendOtpResponse {
  resentAt: string;
  cooldownSeconds: number;
}

export interface CreateKycSessionResponse {
  sessionId: string;
  /** Token que recibe el SDK nativo de Didit (`startVerification`). */
  sessionToken: string;
}

/** El backend devuelve `status`, no `kycStatus` (kyc.schema.ts#kycStatusResponse). */
export interface KycStatusResponse {
  status: KycStatus;
  manualReviewReason: string | null;
}

export interface LoginRequest {
  phone: string;
  password: string;
}

export type LoginResponse = SessionResponse;

export interface RefreshRequest {
  refreshToken: string;
}

/** Mismo shape que `LoginResponse` (auth.schema.ts#refreshResponse en svc-users). */
export type RefreshResponse = SessionResponse;

export interface GeocodeAddressInput {
  street: string;
  number: string;
  floor?: string;
  city: string;
  province: string;
  zip: string;
}

export interface GeocodeAddressResponse {
  lat: number;
  long: number;
  formattedAddress: string;
}

function authHeader(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

export const authClient = {
  register(payload: RegisterRequest): Promise<RegisterResponse> {
    return httpClient.post<RegisterResponse>("/auth/register", payload);
  },

  login(payload: LoginRequest): Promise<LoginResponse> {
    return httpClient.post<LoginResponse>("/auth/login", payload);
  },

  /** `POST /auth/refresh` es pública (el refresh token en el body es la credencial) —
   * se llama directo con `httpClient.post`, nunca pasa por el interceptor de
   * `http-client.ts` (que es justamente quien invoca esta función ante un 401
   * `AUTH_TOKEN_EXPIRED`, así que no puede depender de sí mismo). */
  refresh(payload: RefreshRequest): Promise<RefreshResponse> {
    return httpClient.post<RefreshResponse>("/auth/refresh", payload);
  },

  /** Protegida (requiere `Authorization`, el gateway deriva `x-user-id` del JWT). Arma
   * su propio header en vez de depender del interceptor: se dispara justo cuando la
   * sesión está por invalidarse, más simple pasar el `accessToken` explícito que
   * depender de que el store todavía lo tenga cargado en ese momento. */
  logout(refreshToken: string, accessToken: string): Promise<void> {
    return httpClient.post<void>("/auth/logout", { refreshToken }, authHeader(accessToken));
  },

  sendOtp(phone: string): Promise<SendOtpResponse> {
    return httpClient.post<SendOtpResponse>("/auth/send-otp", { phone });
  },

  verifyOtp(payload: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    return httpClient.post<VerifyOtpResponse>("/auth/verify-otp", payload);
  },

  resendOtp(otpId: string): Promise<ResendOtpResponse> {
    return httpClient.post<ResendOtpResponse>("/auth/resend-otp", { otpId });
  },

  /** Paso de mapa del wizard (MOVO-73): centra el pin inicial a partir de la
   * dirección cargada a mano. Público — se llama antes de que exista cuenta o token. */
  geocodeAddress(payload: GeocodeAddressInput): Promise<GeocodeAddressResponse> {
    return httpClient.post<GeocodeAddressResponse>("/geocode", payload);
  },

  /** Protegida desde PR #51 (MOVO-72) — el `userId` se deriva del `accessToken`, no
   * viaja como parámetro. */
  createKycSession(accessToken: string): Promise<CreateKycSessionResponse> {
    return httpClient.post<CreateKycSessionResponse>("/kyc/session", undefined, authHeader(accessToken));
  },

  getKycStatus(accessToken: string): Promise<KycStatusResponse> {
    return httpClient.get<KycStatusResponse>("/kyc/status", undefined, authHeader(accessToken));
  },

  /**
   * Verificación de licencia de conducir (MOVO-15) — mismo backend que
   * `createKycSession`/`getKycStatus` (`/kyc/license/session`, `/kyc/license/status`),
   * pero **sin** armar el header a mano: a diferencia del onboarding (token efímero de
   * `RegistrationContext`, antes de que exista sesión real), este flujo ocurre con el
   * transportista ya logueado de verdad — se deja que el interceptor de
   * `http-client.ts` adjunte `Authorization` desde `authHooks.getAccessToken()`, con el
   * refresh automático de MOVO-76 incluido.
   */
  createLicenseKycSession(): Promise<CreateKycSessionResponse> {
    return httpClient.post<CreateKycSessionResponse>("/kyc/license/session");
  },

  getLicenseKycStatus(): Promise<KycStatusResponse> {
    return httpClient.get<KycStatusResponse>("/kyc/license/status");
  },
};
