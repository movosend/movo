import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { httpClient } from "./http-client";

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

    if (typeof XMLHttpRequest !== "undefined") {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.setRequestHeader("Content-Length", String(contentLength));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Error al subir la imagen a S3 (HTTP ${xhr.status})`));
          }
        };
        xhr.onerror = () => {
          reject(new Error("Error de red al subir la imagen a S3"));
        };
        xhr.send(blob);
      });
      return;
    }

    const s3Res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(contentLength),
      },
      body: blob,
    });

    if (!s3Res.ok) {
      throw new Error(`Error al subir la imagen (HTTP ${s3Res.status})`);
    }
  },
};


