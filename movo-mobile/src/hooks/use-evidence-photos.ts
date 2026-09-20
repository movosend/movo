import * as Crypto from "expo-crypto";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createPhotoUploadProvider } from "../adapters/photo-upload-provider";
import { friendlyErrorMessage } from "../lib/error-messages";
import { prepareImageForUpload, takePhotoWithCamera, uriToBlob } from "../lib/photo-utils";

// Mismos valores que `photos-step.tsx` (MOVO-83) — sin requisito de producto distinto
// para evidencia de retiro/entrega, se mantiene la misma calidad/tamaño de subida.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.7;
const MAX_BYTES = 2 * 1024 * 1024;

export type EvidencePhotoStatus = "compressing" | "uploading" | "uploaded" | "error";

export interface EvidencePhoto {
  id: string;
  localUri: string;
  status: EvidencePhotoStatus;
  progress: number;
  errorMessage: string | null;
}

/** Señal de un intento de captura que no llegó a producir una foto — la UI decide qué
 * mostrar (alert de permisos, banner de error) según el `type`. `denied`/`unavailable`
 * cubren AC2/AC3 de MOVO-197; `cancelled` no requiere ningún feedback. */
export type CaptureIssue =
  | { type: "cancelled" }
  | { type: "denied"; canAskAgain: boolean }
  | { type: "unavailable" };

/**
 * Orquesta la captura y subida de evidencia fotográfica (`stage: "pickup" |
 * "delivery"`) para el step reusable de MOVO-197. A diferencia del paso de fotos del
 * wizard de creación (MOVO-83, que difiere la subida al submit porque ahí no existe
 * `shipmentId` todavía), acá el envío ya existe de entrada — cada foto sube su propio
 * ciclo completo (`capturar → comprimir → presign → PUT → confirm`) apenas se toma,
 * lo que permite mostrar progreso por foto (AC4) y que abandonar el wizard después de
 * subir no pierda nada (`MOVO-198` AC5, las fotos confirmadas ya están en el servidor).
 *
 * Solo trackea fotos capturadas en este montaje — fotos confirmadas en una sesión
 * previa no tienen forma de recuperar su preview acá (`GET /shipments/:id/photos`
 * excluye al transportista de su autorización, MOVO-196), así que el conteo
 * autoritativo de "cuántas hay en total" sigue viniendo de `useEvidenceStatus`, no de
 * este array local.
 */
export function useEvidencePhotos(shipmentId: string, stage: "pickup" | "delivery") {
  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);
  const [issue, setIssue] = useState<CaptureIssue | null>(null);
  const queryClient = useQueryClient();

  function updatePhoto(id: string, patch: Partial<EvidencePhoto>) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  const uploadPhoto = useCallback(
    async (id: string, localUri: string) => {
      updatePhoto(id, { status: "uploading", progress: 0, errorMessage: null });
      const provider = createPhotoUploadProvider();
      try {
        const prepared = await prepareImageForUpload(localUri, { maxDimension: MAX_DIMENSION, quality: JPEG_QUALITY });
        if (prepared.contentLength > MAX_BYTES) {
          updatePhoto(id, { status: "error", errorMessage: "La imagen es muy pesada, probá con otra." });
          return;
        }
        const blob = prepared.blob ?? (await uriToBlob(prepared.uri));
        const { uploadUrl, s3Key } = await provider.requestUploadUrl(
          shipmentId,
          stage,
          prepared.contentType,
          blob.size,
        );
        await provider.uploadToUrl(uploadUrl, blob, prepared.contentType, (pct) => updatePhoto(id, { progress: pct }));
        await provider.confirmUpload(shipmentId, s3Key, stage);
        updatePhoto(id, { status: "uploaded", progress: 100 });
        await queryClient.invalidateQueries({ queryKey: ["shipments", "detail", shipmentId, "evidence-status"] });
      } catch (err) {
        updatePhoto(id, {
          status: "error",
          errorMessage: friendlyErrorMessage(err, "No se pudo subir esta foto. Reintentá."),
        });
      }
    },
    [shipmentId, stage, queryClient],
  );

  const capture = useCallback(async () => {
    setIssue(null);
    // Sin `allowsEditing`: forzar 1:1 no tiene sentido para evidencia de un paquete o
    // de una puerta/persona, casi nunca cuadrada (mismo criterio que `photos-step.tsx`).
    const result = await takePhotoWithCamera({ allowsEditing: false });
    if (result.unavailable) {
      setIssue({ type: "unavailable" });
      return;
    }
    if (result.permissionDenied) {
      setIssue({ type: "denied", canAskAgain: result.canAskAgain ?? false });
      return;
    }
    if (result.cancelled || !result.uri) {
      setIssue({ type: "cancelled" });
      return;
    }

    const id = Crypto.randomUUID();
    setPhotos((prev) => [...prev, { id, localUri: result.uri!, status: "compressing", progress: 0, errorMessage: null }]);
    await uploadPhoto(id, result.uri);
  }, [uploadPhoto]);

  const retry = useCallback(
    (id: string): Promise<void> => {
      const photo = photos.find((p) => p.id === id);
      if (!photo) return Promise.resolve();
      return uploadPhoto(id, photo.localUri);
    },
    [photos, uploadPhoto],
  );

  /** Solo saca fotos que todavía no se confirmaron contra el backend — no existe un
   * endpoint de borrado (MOVO-196 no lo expone), así que una foto `uploaded` queda
   * fija. Decisión de alcance confirmada explícitamente para MOVO-197 AC7. */
  const remove = useCallback((id: string) => {
    setPhotos((prev) => prev.filter((p) => !(p.id === id && p.status !== "uploaded")));
  }, []);

  const confirmedThisSession = photos.filter((p) => p.status === "uploaded").length;

  return { photos, issue, clearIssue: () => setIssue(null), capture, retry, remove, confirmedThisSession };
}
