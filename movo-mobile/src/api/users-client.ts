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


