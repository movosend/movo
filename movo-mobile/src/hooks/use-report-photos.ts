import * as Crypto from "expo-crypto";
import { useCallback, useRef, useState } from "react";
import { Alert, Linking } from "react-native";
import { MAX_REPORT_PHOTOS_PER_SUBMISSION } from "@movo/shared/dist/types/user";
import { moderationClient } from "../api/moderation-client";
import { friendlyErrorMessage } from "../lib/error-messages";
import { pickPhotoFromGallery, prepareImageForUpload, takePhotoWithCamera, uriToBlob } from "../lib/photo-utils";
import { uploadBlobToPresignedUrl } from "../lib/s3-upload";

// Mismos valores que la evidencia de envíos (`use-evidence-photos.ts`): el backend
// acepta JPEG de hasta 2 MB (MOVO-256).
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.7;
const MAX_BYTES = 2 * 1024 * 1024;

export type ReportPhotoStatus = "uploading" | "uploaded" | "error";

export interface ReportDraftPhoto {
  id: string;
  localUri: string;
  status: ReportPhotoStatus;
  /** Key de S3 una vez subida; es lo que se manda con el reporte o la entrada. */
  s3Key: string | null;
  errorMessage: string | null;
}

function showPermissionAlert(mediaType: "cámara" | "fotos") {
  Alert.alert(
    "Permiso necesario",
    `Movo necesita acceso a tu ${mediaType === "cámara" ? "cámara" : "galería de fotos"} para adjuntar la foto. Podés habilitarlo desde los ajustes de tu dispositivo.`,
    [
      { text: "Cancelar", style: "cancel" },
      { text: "Abrir Ajustes", onPress: () => void Linking.openSettings() },
    ],
  );
}

/**
 * MOVO-256: fotos de evidencia de un envío de reporte (el original o una entrada).
 * Cada foto sube apenas se elige (`comprimir → presign → PUT`), así se ve el estado
 * de cada una antes de enviar y un error queda en la foto puntual, con reintento. Las
 * keys recién se asocian al reporte al enviar; una foto subida y nunca enviada la
 * borra el sweep de huérfanas del backend.
 */
export function useReportPhotos(userId: string) {
  const [photos, setPhotos] = useState<ReportDraftPhoto[]>([]);
  // Espejo síncrono de `photos`: `add` se puede disparar dos veces antes del re-render
  // y el tope por envío tiene que contar las dos.
  const countRef = useRef(0);

  const updatePhoto = useCallback((id: string, patch: Partial<ReportDraftPhoto>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const upload = useCallback(
    async (id: string, localUri: string) => {
      updatePhoto(id, { status: "uploading", errorMessage: null, s3Key: null });
      try {
        const prepared = await prepareImageForUpload(localUri, { maxDimension: MAX_DIMENSION, quality: JPEG_QUALITY });
        if (prepared.contentLength > MAX_BYTES) {
          updatePhoto(id, { status: "error", errorMessage: "La foto es muy pesada, probá con otra." });
          return;
        }
        const blob = prepared.blob ?? (await uriToBlob(prepared.uri));
        const { uploadUrl, s3Key } = await moderationClient.presignReportPhoto(userId, blob.size);
        await uploadBlobToPresignedUrl(uploadUrl, blob, prepared.contentType);
        updatePhoto(id, { status: "uploaded", s3Key });
      } catch (err) {
        updatePhoto(id, {
          status: "error",
          errorMessage: friendlyErrorMessage(err, "No pudimos subir esta foto."),
        });
      }
    },
    [userId, updatePhoto],
  );

  const addFrom = useCallback(
    async (source: "camera" | "gallery") => {
      if (countRef.current >= MAX_REPORT_PHOTOS_PER_SUBMISSION) return;
      // Sin recorte 1:1: una captura de chat o la foto de un paquete casi nunca es cuadrada.
      const result =
        source === "camera"
          ? await takePhotoWithCamera({ allowsEditing: false })
          : await pickPhotoFromGallery({ allowsEditing: false });
      if (result.permissionDenied) {
        showPermissionAlert(source === "camera" ? "cámara" : "fotos");
        return;
      }
      if (result.cancelled || !result.uri) return;
      if (countRef.current >= MAX_REPORT_PHOTOS_PER_SUBMISSION) return;

      const id = Crypto.randomUUID();
      countRef.current += 1;
      setPhotos((prev) => [...prev, { id, localUri: result.uri!, status: "uploading", s3Key: null, errorMessage: null }]);
      await upload(id, result.uri);
    },
    [upload],
  );

  /** Cámara o galería, con el diálogo nativo. */
  const add = useCallback(() => {
    if (countRef.current >= MAX_REPORT_PHOTOS_PER_SUBMISSION) return;
    Alert.alert("Agregar foto", undefined, [
      { text: "Sacar foto", onPress: () => void addFrom("camera") },
      { text: "Elegir de la galería", onPress: () => void addFrom("gallery") },
      { text: "Cancelar", style: "cancel" },
    ]);
  }, [addFrom]);

  const retry = useCallback(
    (id: string) => {
      const photo = photos.find((p) => p.id === id);
      if (photo && photo.status === "error") void upload(id, photo.localUri);
    },
    [photos, upload],
  );

  const remove = useCallback((id: string) => {
    setPhotos((prev) => {
      const next = prev.filter((p) => p.id !== id);
      countRef.current = next.length;
      return next;
    });
  }, []);

  /** Después de enviar: el composer vuelve a quedar vacío. */
  const reset = useCallback(() => {
    countRef.current = 0;
    setPhotos([]);
  }, []);

  const uploadedKeys = photos.flatMap((p) => (p.status === "uploaded" && p.s3Key ? [p.s3Key] : []));

  return {
    photos,
    add,
    retry,
    remove,
    reset,
    uploadedKeys,
    canAddMore: photos.length < MAX_REPORT_PHOTOS_PER_SUBMISSION,
    /** Una foto subiendo o con error bloquea el envío: mandarlo igual la descartaría
     * sin avisar. */
    hasPending: photos.some((p) => p.status !== "uploaded"),
    max: MAX_REPORT_PHOTOS_PER_SUBMISSION,
  };
}
