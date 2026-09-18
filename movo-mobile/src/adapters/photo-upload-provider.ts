import type { ShipmentPhotoStage } from "../api/shipments-client";
import { realPhotoUploadProvider } from "./real-photo-upload-provider";

/**
 * Upload de fotos de envío contra `POST /shipments/:id/photos/presign` +
 * `/photos/confirm` (MOVO-81). El wizard de creación (MOVO-83 AC6/AC12, `stage:
 * "creation"`) necesita un `shipmentId` real que recién existe después de
 * `POST /shipments` — por eso ese paso solo captura/comprime/previsualiza localmente,
 * y este provider se invoca DESPUÉS del submit exitoso (`summary-step.tsx#uploadPhotos`).
 * El step reusable de evidencia (MOVO-197, `stage: "pickup" | "delivery"`) en cambio ya
 * tiene el `shipmentId` de entrada — sube cada foto apenas se captura.
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
    stage: ShipmentPhotoStage,
    contentType: string,
    contentLength: number,
  ): Promise<RequestUploadUrlResult>;
  uploadToUrl(uploadUrl: string, blob: Blob, contentType: string, onProgress?: (pct: number) => void): Promise<void>;
  confirmUpload(shipmentId: string, s3Key: string, stage: ShipmentPhotoStage): Promise<void>;
}

export function createPhotoUploadProvider(): PhotoUploadProvider {
  return realPhotoUploadProvider;
}
