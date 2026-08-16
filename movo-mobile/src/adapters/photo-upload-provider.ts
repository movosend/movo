import { mockPhotoUploadProvider } from "./mock-photo-upload-provider";

/**
 * Upload de las 2 fotos obligatorias del wizard de envíos (MOVO-83 AC6/AC12) contra
 * el contrato futuro de MOVO-81 (`POST /shipments/:id/photos/presign` +
 * `/photos/confirm`, todavía sin implementar). Necesita un `shipmentId` real, que
 * recién existe después de `POST /shipments` — por eso el paso de fotos del wizard
 * solo captura/comprime/previsualiza localmente, y este provider se invoca DESPUÉS
 * del submit exitoso, como sub-etapa de "confirmando" antes de navegar.
 */
export interface RequestUploadUrlResult {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export interface PhotoUploadProvider {
  requestUploadUrl(shipmentId: string, stage: "creation"): Promise<RequestUploadUrlResult>;
  uploadToUrl(uploadUrl: string, blob: Blob, contentType: string, onProgress?: (pct: number) => void): Promise<void>;
  confirmUpload(shipmentId: string, s3Key: string): Promise<void>;
}

/** true mientras MOVO-81 no exista — cambiar a `false` cuando ese ticket cierre y
 * haya un `RealPhotoUploadProvider` que hable contra el endpoint real. */
const USE_MOCK_PHOTO_UPLOAD = true;

export function createPhotoUploadProvider(): PhotoUploadProvider {
  if (USE_MOCK_PHOTO_UPLOAD) return mockPhotoUploadProvider;
  throw new Error("RealPhotoUploadProvider no implementado todavía — ver MOVO-81.");
}
