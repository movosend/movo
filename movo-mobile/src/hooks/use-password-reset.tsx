import { ApiError } from "@movo/shared/dist/errors/api-error";
import { useState } from "react";
import { authClient } from "../api/auth-client";
import { friendlyErrorMessage } from "../lib/error-messages";

/**
 * Estado y acciones del wizard de recuperación de contraseña (MOVO-141, backend
 * MOVO-140). A diferencia de `use-registration.tsx` (un `Context` para un wizard de 7
 * pasos resumible entre sesiones), esto es un hook plano: todo el flujo vive y muere
 * en una sola pantalla, no hace falta persistir nada entre sesiones ni compartirlo
 * fuera de `forgot-password.tsx`.
 *
 * Mismo *shape* de acciones que las de `use-registration.tsx`
 * (`sendOtp`/`verifyPhoneOtp`/`resendOtp`): cada una hace su propio
 * `try/catch`/`finally`, deja el mensaje de error en `errorBanner` y devuelve
 * `{ ok: boolean }` en vez de tirar — el screen no repite manejo de excepciones.
 */
export function usePasswordReset() {
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [otpId, setOtpId] = useState<string | null>(null);
  const [channel, setChannel] = useState<"sms" | "email" | null>(null);
  const [passwordResetToken, setPasswordResetToken] = useState<string | null>(null);

  function clearError() {
    setErrorBanner(null);
  }

  function reset() {
    setOtpId(null);
    setChannel(null);
    setPasswordResetToken(null);
    setErrorBanner(null);
  }

  async function requestReset(
    identifier: string,
  ): Promise<{ ok: boolean; cooldownSeconds?: number }> {
    setLoading(true);
    setErrorBanner(null);
    try {
      const result = await authClient.forgotPassword(identifier);
      setOtpId(result.otpId);
      setChannel(result.channel);
      return { ok: true, cooldownSeconds: result.cooldownSeconds };
    } catch (err) {
      setErrorBanner(friendlyErrorMessage(err, "No pudimos enviar el código. Intentá de nuevo."));
      return { ok: false };
    } finally {
      setLoading(false);
    }
  }

  /** AC7 (parcial): un OTP vencido (422) no se puede reintentar tipeando de nuevo —
   * `expired: true` le indica al screen que tiene que volver al paso 1 a pedir uno
   * nuevo, en vez de solo mostrar el banner y dejar el código vencido en pantalla. */
  async function verifyOtp(code: string): Promise<{ ok: boolean; expired?: boolean }> {
    if (!otpId) return { ok: false };
    setLoading(true);
    setErrorBanner(null);
    try {
      const result = await authClient.verifyResetOtp(otpId, code);
      setPasswordResetToken(result.passwordResetToken);
      return { ok: true };
    } catch (err) {
      setErrorBanner(
        friendlyErrorMessage(err, "No pudimos verificar el código. Intentá de nuevo."),
      );
      const expired = err instanceof ApiError && err.code === "AUTH_OTP_EXPIRED";
      return { ok: false, expired };
    } finally {
      setLoading(false);
    }
  }

  async function resend(): Promise<{ ok: boolean; cooldownSeconds?: number }> {
    if (!otpId) return { ok: false };
    setLoading(true);
    setErrorBanner(null);
    try {
      const result = await authClient.resendOtp(otpId);
      return { ok: true, cooldownSeconds: result.cooldownSeconds };
    } catch (err) {
      setErrorBanner(friendlyErrorMessage(err, "No pudimos reenviar el código. Intentá de nuevo."));
      return { ok: false };
    } finally {
      setLoading(false);
    }
  }

  /** AC7: un `passwordResetToken` vencido/usado/inválido devuelve `tokenInvalid: true`
   * para que el screen reinicie el wizard entero, no solo muestre el banner. */
  async function completeReset(
    newPassword: string,
  ): Promise<{ ok: boolean; tokenInvalid?: boolean }> {
    if (!passwordResetToken) return { ok: false };
    setLoading(true);
    setErrorBanner(null);
    try {
      await authClient.resetPassword(passwordResetToken, newPassword);
      return { ok: true };
    } catch (err) {
      setErrorBanner(
        friendlyErrorMessage(err, "No pudimos cambiar la contraseña. Intentá de nuevo."),
      );
      const tokenInvalid = err instanceof ApiError && err.code === "AUTH_OTP_INVALID";
      return { ok: false, tokenInvalid };
    } finally {
      setLoading(false);
    }
  }

  return {
    loading,
    errorBanner,
    channel,
    clearError,
    reset,
    requestReset,
    verifyOtp,
    resend,
    completeReset,
  };
}
