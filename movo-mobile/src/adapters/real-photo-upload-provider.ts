import { shipmentsClient } from "../api/shipments-client";
import { uploadBlobToPresignedUrl } from "../lib/s3-upload";
import type { PhotoUploadProvider, RequestUploadUrlResult } from "./photo-upload-provider";

/**
 * Implementación real de `PhotoUploadProvider` contra MOVO-81. `uploadToUrl` habla
 * directo con S3 (fuera de `httpClient`, ADR-007) — mandar el Bearer token de Movo a
 * AWS haría fallar la firma con 403 y filtraría el JWT, mismo criterio que
 * `usersClient.uploadPhotoToS3` (MOVO-97/98).
 */
async function requestUploadUrl(
  shipmentId: string,
  stage: "creation",
  contentType: string,
  contentLength: number,
): Promise<RequestUploadUrlResult> {
  return shipmentsClient.presignPhoto(shipmentId, {
    stage,
    contentType: contentType as "image/jpeg",
    contentLength,
  });
}

async function uploadToUrl(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  await uploadBlobToPresignedUrl(uploadUrl, blob, contentType, onProgress);
}

async function confirmUpload(shipmentId: string, s3Key: string, stage: "creation"): Promise<void> {
  await shipmentsClient.confirmPhoto(shipmentId, { s3Key, stage });
}

export const realPhotoUploadProvider: PhotoUploadProvider = {
  requestUploadUrl,
  uploadToUrl,
  confirmUpload,
};
