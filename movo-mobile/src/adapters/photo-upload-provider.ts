import { realPhotoUploadProvider } from "./real-photo-upload-provider";

/**
 * Upload de las 2 fotos obligatorias del wizard de envíos (MOVO-83 AC6/AC12) contra
 * `POST /shipments/:id/photos/presign` + `/photos/confirm` (MOVO-81). Necesita un
 * `shipmentId` real, que recién existe después de `POST /shipments` — por eso el paso
 * de fotos del wizard solo captura/comprime/previsualiza localmente, y este provider
 * se invoca DESPUÉS del submit exitoso, como sub-etapa de "confirmando" antes de
 * navegar (`summary-step.tsx#uploadPhotos`).
 */
export interface RequestUploadUrlResult {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export interface PhotoUploadProvider {
  /** `contentType`/`contentLength` viajan firmados dentro de la presigned URL (AC3 de
   * MOVO-81) — tienen que ser el tipo/tamaño exactos del blob que se sube después. */
  requestUploadUrl(
    shipmentId: string,
    stage: "creation",
    contentType: string,
    contentLength: number,
  ): Promise<RequestUploadUrlResult>;
  uploadToUrl(uploadUrl: string, blob: Blob, contentType: string, onProgress?: (pct: number) => void): Promise<void>;
  confirmUpload(shipmentId: string, s3Key: string, stage: "creation"): Promise<void>;
}

export function createPhotoUploadProvider(): PhotoUploadProvider {
  return realPhotoUploadProvider;
}
