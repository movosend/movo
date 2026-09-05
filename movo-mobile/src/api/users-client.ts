import type { PrivateProfile, PublicProfile } from "@movo/shared/dist/types/user-profile";
import { httpClient } from "./http-client";
import type { SessionResponse } from "./session-types";
import { uploadBlobToPresignedUrl } from "../lib/s3-upload";

/**
 * `PrivateProfile` viene de `@movo/shared` (MOVO-78, migrado desde
 * `services/movo-svc-users/src/models/user-profile.ts` para no duplicar el wire
 * contract) — subpath directo (`dist/types/user-profile`), nunca el barrel raíz
 * `@movo/shared` (arrastra `jsonwebtoken`/`node:crypto`, rompe Metro — mismo criterio
 * que `@movo/shared/dist/types/user` en el resto del mobile).
 */
export interface PhotoUploadUrlInput {
  contentType: string;
  contentLength: number;
}

export interface PhotoUploadUrlResponse {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

export interface ConfirmPhotoResponse {
  photoUrl: string;
}

/** Body de `PATCH /users/me` (MOVO-133). El backend rechaza con 400 cualquier clave
 * fuera de estas — `bio` es MOVO-171, todavía sin backend (el schema real hoy
 * solo acepta `firstName`/`lastName`, mandar `bio` es 400 hasta que exista). */
export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  bio?: string;
}

/** MOVO-174, todavía sin backend. */
export interface MutualConnections {
  totalCount: number;
  sampleFirstNames: string[];
}

/**
 * Respuesta del paso 1 de los cambios verificados de teléfono/email (MOVO-133), y
 * también de la verificación del email actual (MOVO-139) — mismo shape, mismo motor
 * de OTP.
 *
 * `sent: false` significa que el backend reusó un OTP todavía activo dentro de su
 * cooldown en vez de mandar un código nuevo — la UI no debe prometer "te acabamos de
 * enviar un código" en ese caso.
 */
export interface OtpRequestResponse {
  otpId: string;
  cooldownSeconds: number;
  sent: boolean;
}

export interface OtpVerifyInput {
  otpId: string;
  code: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * `PrivateProfile` viene de `@movo/shared` (MOVO-78, migrado desde
 * `services/movo-svc-users/src/models/user-profile.ts` para no duplicar el wire
 * contract) — subpath directo (`dist/types/user-profile`), nunca el barrel raíz
 * `@movo/shared` (arrastra `jsonwebtoken`/`node:crypto`, rompe Metro — mismo criterio
 * que `@movo/shared/dist/types/user` en el resto del mobile).
 */
export const usersClient = {
  /** Protegida — `httpClient` adjunta `Authorization` automáticamente vía el
   * interceptor de sesión (MOVO-76), no hay razón para pasar el header a mano acá
   * como sí hace `authClient.logout`. */
  getMyProfile(): Promise<PrivateProfile> {
    return httpClient.get<PrivateProfile>("/users/me");
  },

  /** Proyección pública de cualquier usuario (`GET /users/:id`, MOVO-77) — usada por
   * la card de receptor/transportista del detalle de envío (MOVO-127). */
  getPublicProfile(id: string): Promise<PublicProfile> {
    return httpClient.get<PublicProfile>(`/users/${id}`);
  },

  /** Búsqueda de receptor para el wizard de envíos (MOVO-83) — `GET /users/search`
   * ya existía en el backend desde MOVO-80, sin wirear en mobile hasta ahora. Busca
   * por `firstName`+`lastName` (nunca email/teléfono, evita enumeración), excluye al
   * caller. `q` debe tener al menos 2 caracteres (el backend lo exige). */
  search(q: string): Promise<PublicProfile[]> {
    return httpClient.get<PublicProfile[]>("/users/search", { q });
  },

  /** `GET /users/:id/mutual-connections` (MOVO-174, todavía sin implementar en
   * `svc-users` — ver esa issue para el contrato propuesto, incluida la decisión
   * de privacidad pendiente sobre `sampleFirstNames`). */
  getMutualConnections(id: string): Promise<MutualConnections> {
    return httpClient.get<MutualConnections>(`/users/${id}/mutual-connections`);
  },

  /** Pide presigned URL para subir foto a S3 (MOVO-97/98, ADR-007). */
  getPhotoUploadUrl(body: PhotoUploadUrlInput): Promise<PhotoUploadUrlResponse> {
    return httpClient.post<PhotoUploadUrlResponse>("/users/me/photo/upload-url", body);
  },

  /** Confirma la foto subida a S3 persistiendo `photo_url` en la base de datos. */
  confirmPhoto(body: { objectKey: string }): Promise<ConfirmPhotoResponse> {
    return httpClient.put<ConfirmPhotoResponse>("/users/me/photo", body);
  },

  /** Borra la foto de perfil propia (S3 + DB) de forma idempotente. */
  deletePhoto(): Promise<void> {
    return httpClient.delete<void>("/users/me/photo");
  },

  /**
   * Actualización parcial de nombre/apellido (`PATCH /users/me`, MOVO-133).
   * Devuelve el `PrivateProfile` completo, no una proyección — por eso los hooks
   * pueden sembrar la cache con la respuesta en vez de refetchear.
   *
   * `409 PROFILE_NAME_LOCKED_BY_KYC` si el KYC de identidad ya está aprobado: el
   * nombre quedó validado contra el documento por Didit y deja de ser editable. La
   * UI deshabilita los campos antes de llegar a ese error (AC3 de MOVO-135), así que
   * el 409 es la red de seguridad, no el camino esperado. Reenviar el mismo nombre
   * NO cuenta como cambio y no dispara el 409.
   */
  updateProfile(body: UpdateProfileInput): Promise<PrivateProfile> {
    return httpClient.patch<PrivateProfile>("/users/me", body);
  },

  /**
   * Paso 1 del cambio de teléfono: manda un OTP al número NUEVO (prueba de posesión).
   * `409 PHONE_ALREADY_IN_USE` si es de otra cuenta, `400` si es el que ya tiene.
   *
   * Protegida por JWT, a diferencia de `POST /auth/send-otp` (pública) que usa el
   * registro. El reenvío, en cambio, sí reusa `authClient.resendOtp(otpId)`.
   */
  requestPhoneChange(phone: string): Promise<OtpRequestResponse> {
    return httpClient.post<OtpRequestResponse>("/users/me/phone/change/otp", { phone });
  },

  /**
   * Paso 2 del cambio de teléfono. Como el target del OTP ES el teléfono nuevo,
   * verificarlo prueba la posesión y persiste `phone` + `phoneVerified` en el mismo
   * UPDATE. `401 AUTH_OTP_INVALID` (código malo o reusado), `422 AUTH_OTP_EXPIRED`
   * (vencido o demasiados intentos), `409 PHONE_ALREADY_IN_USE` si la colisión
   * aparece recién acá (carrera entre los dos pasos).
   */
  verifyPhoneChange(body: OtpVerifyInput): Promise<PrivateProfile> {
    return httpClient.post<PrivateProfile>("/users/me/phone/change/verify", body);
  },

  /**
   * Paso 1 del cambio de email. **El OTP va al email NUEVO** (MOVO-139, corrige el
   * criterio original de MOVO-133 que lo mandaba al teléfono actual por no existir
   * ningún `EmailProvider` todavía) — es lo que prueba propiedad de la dirección
   * nueva. `409 EMAIL_ALREADY_IN_USE` es case-insensitive, `400` si es el mismo email
   * que ya tiene.
   */
  requestEmailChange(email: string): Promise<OtpRequestResponse> {
    return httpClient.post<OtpRequestResponse>("/users/me/email/change/otp", { email });
  },

  /**
   * Paso 2 del cambio de email. Como el target del OTP ES el email nuevo, verificarlo
   * persiste `email` + `emailVerified` en el mismo UPDATE (MOVO-139). Dispara un
   * aviso al email anterior (best-effort, del lado del backend). No revoca sesiones
   * (el email no es credencial de sesión y el titular ya está autenticado).
   */
  verifyEmailChange(body: OtpVerifyInput): Promise<PrivateProfile> {
    return httpClient.post<PrivateProfile>("/users/me/email/change/verify", body);
  },

  /**
   * Verificar el email ACTUAL de la cuenta (MOVO-139, CTA de la pantalla de perfil
   * para cuentas creadas antes de que este flujo existiera). Sin body: el target del
   * OTP es el email que la cuenta ya tiene. `400` si ya está verificado.
   */
  requestEmailVerification(): Promise<OtpRequestResponse> {
    return httpClient.post<OtpRequestResponse>("/users/me/email/verify/otp", {});
  },

  /** Paso 2 de la verificación del email actual: persiste `emailVerified: true`. No
   * cambia el email en sí, a diferencia de `verifyEmailChange`. */
  verifyEmailVerification(body: OtpVerifyInput): Promise<PrivateProfile> {
    return httpClient.post<PrivateProfile>("/users/me/email/verify/confirm", body);
  },

  /**
   * Cambia la contraseña propia (`POST /users/me/password`, MOVO-134).
   *
   * Devuelve un `SessionResponse` completo, igual que `login()`: el backend revoca
   * TODAS las sesiones del usuario y emite un par de tokens nuevo, así que el
   * dispositivo que hizo el cambio no queda deslogueado pero el refresh token viejo
   * ya no sirve. El caller está obligado a persistir la respuesta con
   * `useAuthStore.setSession()` — ver `use-account-security.ts`, donde eso ocurre.
   *
   * Un `401 AUTH_INVALID_CREDENTIALS` acá significa "la contraseña actual no es
   * correcta", NO que la sesión venció: el interceptor de `http-client.ts` solo
   * dispara el refresh ante `AUTH_TOKEN_EXPIRED`, cualquier otro 401 se propaga tal
   * cual sin tocar la sesión (AC3 de MOVO-136).
   */
  changePassword(body: ChangePasswordInput): Promise<SessionResponse> {
    return httpClient.post<SessionResponse>("/users/me/password", body);
  },

  /**
   * Baja de cuenta (MOVO-136 AC5/AC6, backend MOVO-134). `DELETE /users/me` con la
   * contraseña en el body: el JWT solo no alcanza para una operación irreversible.
   * Responde `204` sin contenido — de ahí el `Promise<void>`.
   *
   * El backend hace soft-delete + anonimización de PII (`anonymizeAndDelete()`),
   * revoca todas las sesiones y borra push tokens, direcciones, KYC y la foto de S3.
   * Es idempotente: una cuenta ya dada de baja vuelve a responder 204.
   *
   * Errores que el caller tiene que distinguir (los tres son 409):
   * `ACCOUNT_HAS_ACTIVE_SHIPMENTS` y `ACCOUNT_HAS_ACTIVE_DISPUTES` — el backend NO
   * cancela en cascada, el usuario resuelve y reintenta — y
   * `ACCOUNT_DELETION_IN_PROGRESS` (lock por usuario: doble tap o dos dispositivos a
   * la vez). Un `401 AUTH_INVALID_CREDENTIALS` es la contraseña mal, igual que en
   * `changePassword()`, no una sesión vencida.
   */
  deleteAccount(password: string): Promise<void> {
    return httpClient.delete<void>("/users/me", { password });
  },

  /**
   * Sube el binario de la imagen directo a la presigned URL de S3 usando XMLHttpRequest
   * o fetch FUERA de `httpClient` (ADR-007 / MOVO-97): evita mandar el header Authorization
   * con nuestro JWT a AWS (lo que fallaría la firma con 403 y filtraría el token).
   */
  async uploadPhotoToS3(
    uploadUrl: string,
    imageSource: string | Blob,
    contentType: string,
    contentLength: number,
  ): Promise<void> {
    let blob: Blob;
    if (typeof imageSource === "string") {
      if (typeof XMLHttpRequest !== "undefined") {
        blob = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload = () => {
            if (xhr.response) resolve(xhr.response as Blob);
            else reject(new Error("No se pudo obtener el blob de la imagen local."));
          };
          xhr.onerror = () => reject(new Error("Error al leer el archivo de imagen local."));
          xhr.responseType = "blob";
          xhr.open("GET", imageSource, true);
          xhr.send(null);
        });
      } else {
        const localRes = await fetch(imageSource);
        blob = await localRes.blob();
      }
    } else {
      blob = imageSource;
    }

    // `contentLength` ya viaja en el header vía `blob.size` dentro del helper
    // compartido (MOVO-83) — se ignora el parámetro acá salvo para preservar la
    // firma pública existente de este método (callers ya establecidos: PhotoPicker).
    void contentLength;
    await uploadBlobToPresignedUrl(uploadUrl, blob, contentType);
  },
};


