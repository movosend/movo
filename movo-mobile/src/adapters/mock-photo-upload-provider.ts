import * as Crypto from "expo-crypto";
import type { PhotoUploadProvider, RequestUploadUrlResult } from "./photo-upload-provider";

/**
 * Mock de `PhotoUploadProvider` (MOVO-81 sin implementar todavía) — no sube nada a
 * ningún lado. Simula latencia de red y progreso con `setTimeout` para que la barra
 * de progreso del paso de fotos tenga algo real que animar y sea testeable sin
 * backend, igual criterio que `MockStorageProvider` del lado servidor (MOVO-97).
 */
const FAKE_UPLOAD_STEPS = 5;
const FAKE_STEP_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestUploadUrl(shipmentId: string, stage: "creation"): Promise<RequestUploadUrlResult> {
  await delay(FAKE_STEP_DELAY_MS);
  const uuid = Crypto.randomUUID();
  return {
    uploadUrl: `mock://upload/${shipmentId}/${stage}/${uuid}`,
    s3Key: `shipments/${shipmentId}/${stage}/${uuid}.jpg`,
    expiresIn: 300,
  };
}

async function uploadToUrl(
  _uploadUrl: string,
  _blob: Blob,
  _contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  for (let step = 1; step <= FAKE_UPLOAD_STEPS; step += 1) {
    await delay(FAKE_STEP_DELAY_MS);
    onProgress?.(Math.round((step / FAKE_UPLOAD_STEPS) * 100));
  }
}

async function confirmUpload(_shipmentId: string, _s3Key: string): Promise<void> {
  await delay(FAKE_STEP_DELAY_MS);
}

export const mockPhotoUploadProvider: PhotoUploadProvider = {
  requestUploadUrl,
  uploadToUrl,
  confirmUpload,
};
