import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
} from "@movo/shared/dist/types/admin-support";
import * as Crypto from "expo-crypto";
import { useCallback, useRef, useState } from "react";
import { Alert, Linking } from "react-native";
import { supportClient } from "../api/support-client";
import { friendlyErrorMessage } from "../lib/error-messages";
import { pickPhotoFromGallery, prepareImageForUpload, takePhotoWithCamera, uriToBlob } from "../lib/photo-utils";

// Mismo criterio que el panel: lado mayor 1600 px. JPEG para que pese poco (el servidor acepta hasta 5 MB).
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.7;

export type SupportPhotoStatus = "uploading" | "uploaded" | "error";

export interface SupportDraftPhoto {
  id: string;
  localUri: string;
  status: SupportPhotoStatus;
  /** Id del adjunto una vez subido; es lo que se manda en `attachmentIds`. */
  attachmentId: string | null;
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
 * MOVO-324 (MOVO-321): fotos de la próxima consulta o respuesta. Cada una sube apenas se elige
 * (`comprimir → presign → PUT`), así se ve el estado de cada una antes de enviar y un error queda en la foto
 * puntual, con reintento. Los ids recién se asocian al mensaje al enviar; los adjuntos que nunca se envían los
 * limpia el servidor. Mismo molde que `use-report-photos.ts`.
 *
 * `conversationId` va en el pedido de la URL cuando la consulta ya existe; en una consulta nueva no hay todavía.
 */
export function useSupportPhotos(conversationId?: string) {
  const [photos, setPhotos] = useState<SupportDraftPhoto[]>([]);
  // Espejo síncrono de `photos`: `add` se puede disparar dos veces antes del re-render y el tope tiene que contar las dos.
  const countRef = useRef(0);

  const updatePhoto = useCallback((id: string, patch: Partial<SupportDraftPhoto>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const upload = useCallback(
    async (id: string, localUri: string) => {
      updatePhoto(id, { status: "uploading", errorMessage: null, attachmentId: null });
      try {
        const prepared = await prepareImageForUpload(localUri, { maxDimension: MAX_DIMENSION, quality: JPEG_QUALITY });
        if (prepared.contentLength > SUPPORT_ATTACHMENT_MAX_BYTES) {
          updatePhoto(id, { status: "error", errorMessage: "La foto es muy pesada, probá con otra." });
          return;
        }
        const blob = prepared.blob ?? (await uriToBlob(prepared.uri));
        const { attachmentId } = await supportClient.uploadAttachment(blob, "image/jpeg", conversationId);
        updatePhoto(id, { status: "uploaded", attachmentId });
      } catch (err) {
        updatePhoto(id, { status: "error", errorMessage: friendlyErrorMessage(err, "No pudimos subir esta foto.") });
      }
    },
    [conversationId, updatePhoto],
  );

  const addFrom = useCallback(
    async (source: "camera" | "gallery") => {
      if (countRef.current >= SUPPORT_ATTACHMENT_MAX_PER_MESSAGE) return;
      // Sin recorte 1:1: una captura de pantalla o la foto de un paquete casi nunca es cuadrada.
      const result =
        source === "camera"
          ? await takePhotoWithCamera({ allowsEditing: false })
          : await pickPhotoFromGallery({ allowsEditing: false });
      if (result.permissionDenied) {
        showPermissionAlert(source === "camera" ? "cámara" : "fotos");
        return;
      }
      if (result.cancelled || !result.uri) return;
      if (countRef.current >= SUPPORT_ATTACHMENT_MAX_PER_MESSAGE) return;

      const id = Crypto.randomUUID();
      countRef.current += 1;
      setPhotos((prev) => [...prev, { id, localUri: result.uri!, status: "uploading", attachmentId: null, errorMessage: null }]);
      await upload(id, result.uri);
    },
    [upload],
  );

  /** Cámara o galería, con el diálogo nativo. */
  const add = useCallback(() => {
    if (countRef.current >= SUPPORT_ATTACHMENT_MAX_PER_MESSAGE) return;
    Alert.alert("Agregar foto", undefined, [
      { text: "Sacar una foto", onPress: () => void addFrom("camera") },
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

  /** Después de enviar: el campo vuelve a quedar vacío. */
  const reset = useCallback(() => {
    countRef.current = 0;
    setPhotos([]);
  }, []);

  return {
    photos,
    add,
    retry,
    remove,
    reset,
    uploadedIds: photos.flatMap((p) => (p.status === "uploaded" && p.attachmentId ? [p.attachmentId] : [])),
    canAddMore: photos.length < SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
    /** Una foto subiendo o con error bloquea el envío: mandarlo igual la descartaría sin avisar. */
    hasPending: photos.some((p) => p.status !== "uploaded"),
    max: SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
  };
}
