/**
 * PUT genérico de un blob a una presigned URL de S3, extraído de
 * `usersClient.uploadPhotoToS3` (MOVO-97/98) para reusarlo también en el
 * `PhotoUploadProvider` real del wizard de envíos (MOVO-83/MOVO-81) — mismo motivo
 * original: XMLHttpRequest en vez de `fetch` porque en algunos entornos RN el body
 * de un `fetch` con un `Blob` local no se comporta de forma confiable.
 *
 * A diferencia del helper original, expone `onProgress` (vía `xhr.upload.onprogress`)
 * — el paso de fotos del wizard necesita un porcentaje real para su barra de
 * progreso, no solo un resolve/reject al final.
 */
export function uploadBlobToPresignedUrl(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (typeof XMLHttpRequest === "undefined") {
    return fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(blob.size) },
      body: blob,
    }).then((res) => {
      if (!res.ok) {
        throw new Error(`Error al subir la imagen (HTTP ${res.status})`);
      }
    });
  }

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("Content-Length", String(blob.size));
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
    }
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
}
