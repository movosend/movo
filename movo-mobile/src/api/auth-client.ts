import type { KycStatus } from "@movo/shared/dist/types/user";
import { httpClient } from "./http-client";

/**
 * Contrato propuesto para MOVO-70/MOVO-72 (dejado como comentario en Linear
 * en esos tickets + en MOVO-73). Los endpoints todavía no existen en
 * `movo-svc-users` — este cliente ya queda implementado contra el contrato
 * acordado, listo para funcionar apenas el backend los publique.
 *
 * La verificación de teléfono ahora ocurre ANTES de crear la cuenta (dentro
 * del wizard de registro, para calzar con el mockup) — ya no depende de un
 * `userId`. Son dos llamadas nuevas (`send-otp`/`verify-otp`, sin cuenta
 * todavía) en vez de la única `verify-phone` post-alta que tenía el contrato
 * anterior; el `phoneVerificationToken` que devuelve `verify-otp` viaja en el
 * body de `register` para probar que ese teléfono fue verificado. Cambio de
 * contrato documentado en los comentarios de MOVO-70/MOVO-72/MOVO-73 en
 * Linear — coordinar con el equipo de backend antes de implementarlo.
 */

export interface RegisterAddress {
  street: string;
  number: string;
  floor?: string;
  city: string;
  province: string;
  zip: string;
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

export interface RegisterResponse {
  userId: string;
  kycStatus: KycStatus;
}

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

export interface KycStatusResponse {
  kycStatus: KycStatus;
}

export const authClient = {
  register(payload: RegisterRequest): Promise<RegisterResponse> {
    return httpClient.post<RegisterResponse>("/auth/register", payload);
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

  createKycSession(userId: string): Promise<CreateKycSessionResponse> {
    return httpClient.post<CreateKycSessionResponse>("/kyc/session", { userId });
  },

  getKycStatus(userId: string): Promise<KycStatusResponse> {
    return httpClient.get<KycStatusResponse>("/kyc/status", { userId });
  },
};
