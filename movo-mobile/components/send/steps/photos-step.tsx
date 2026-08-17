import * as Crypto from "expo-crypto";
import { Camera } from "lucide-react-native";
import { useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { prepareImageForUpload, takePhotoWithCamera } from "../../../src/lib/photo-utils";
import { useShipmentWizardStore, type WizardPhoto } from "../../../src/store/shipment-wizard-store";
import { AddPhotoTile, PhotoSlot } from "../photo-slot";

export const REQUIRED_PHOTO_COUNT = 2;
export const MAX_PHOTO_COUNT = 6;
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.7;
const MAX_BYTES = 2 * 1024 * 1024;
// 3 columnas, mismo gap que `gap-2.5` (10px) — el tamaño de celda se deriva del ancho
// real del grid (`onLayout`, ver el comentario de `AddPhotoTileProps.size`) en vez de
// `w-[30%]` + `aspectRatio: 1`, que Yoga no resuelve bien con una sola celda.
const GRID_COLUMNS = 3;
const GRID_GAP = 10;

/** AC6: al menos 2 fotos obligatorias, hasta `MAX_PHOTO_COUNT`. Este paso solo
 * captura + comprime + previsualiza localmente (sin red) — el upload real pasa a ser
 * parte del submit (ver `summary-step.tsx`), porque MOVO-81 presigna contra `POST
 * /shipments/:id/photos/presign`, que necesita un `id` de envío que todavía no existe
 * durante el wizard. */
export function isPhotosStepValid(state: { photos: WizardPhoto[] }): boolean {
  return state.photos.filter((p) => p.status === "uploaded").length >= REQUIRED_PHOTO_COUNT;
}

// Mismo patrón que `photo-picker.tsx` (MOVO-98) para pedir permiso de cámara de nuevo
// desde Ajustes — un permiso denegado no debería quedar en silencio.
function showCameraPermissionAlert() {
  Alert.alert(
    "Permiso necesario",
    "Movo necesita acceso a tu cámara para sacar las fotos del paquete. Podés habilitarlo desde los ajustes de tu dispositivo.",
    [
      { text: "Cancelar", style: "cancel" },
      { text: "Abrir Ajustes", onPress: () => void Linking.openSettings() },
    ],
  );
}

export function PhotosStep() {
  const { photos, addPhoto, updatePhoto, removePhoto } = useShipmentWizardStore();
  const [slotSize, setSlotSize] = useState(0);

  async function captureInto(existingId?: string) {
    // Sin `allowsEditing`: forzar el recorte cuadrado 1:1 tiene sentido para una foto
    // de perfil (MOVO-98), no para evidencia de un paquete, casi nunca cuadrado.
    const result = await takePhotoWithCamera({ allowsEditing: false });
    if (result.permissionDenied) {
      showCameraPermissionAlert();
      return;
    }
    if (result.cancelled || !result.uri) return;

    const id = existingId ?? Crypto.randomUUID();
    if (existingId) {
      updatePhoto(existingId, { status: "compressing", localUri: result.uri, errorMessage: null });
    } else {
      addPhoto({ id, localUri: result.uri, status: "compressing", progress: 0, s3Key: null, errorMessage: null });
    }

    try {
      const prepared = await prepareImageForUpload(result.uri, { maxDimension: MAX_DIMENSION, quality: JPEG_QUALITY });
      if (prepared.contentLength > MAX_BYTES) {
        updatePhoto(id, { status: "error", errorMessage: "La imagen es muy pesada, probá con otra." });
        return;
      }
      updatePhoto(id, { status: "uploaded", localUri: prepared.uri });
    } catch {
      updatePhoto(id, { status: "error", errorMessage: "No pudimos procesar la foto. Probá de nuevo." });
    }
  }

  const canAddMore = photos.length < MAX_PHOTO_COUNT;

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <Camera size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">Fotos del paquete</Text>
        <Text className="font-sans text-body text-fg-2">
          Sacá al menos 2 fotos como evidencia del estado inicial.
        </Text>
      </View>

      <View
        testID="photos-step-grid"
        className="flex-row flex-wrap gap-2.5"
        onLayout={(e) => setSlotSize((e.nativeEvent.layout.width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS)}
      >
        {photos.map((photo, index) => (
          <PhotoSlot
            key={photo.id}
            testID={`photos-step-slot-${index}`}
            photo={photo}
            size={slotSize}
            onRetry={() => captureInto(photo.id)}
            onRemove={() => removePhoto(photo.id)}
          />
        ))}
        {canAddMore ? (
          <AddPhotoTile key="add-tile" testID="photos-step-add" size={slotSize} onPress={() => captureInto()} />
        ) : null}
      </View>
    </View>
  );
}
