import * as Crypto from "expo-crypto";
import { Camera } from "lucide-react-native";
import { Text, View } from "react-native";
import { prepareImageForUpload, takePhotoWithCamera } from "../../../src/lib/photo-utils";
import { useShipmentWizardStore, type WizardPhoto } from "../../../src/store/shipment-wizard-store";
import { PhotoSlot } from "../photo-slot";

export const REQUIRED_PHOTO_COUNT = 2;
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.7;
const MAX_BYTES = 2 * 1024 * 1024;

/** AC6: 2 fotos obligatorias. Este paso solo captura + comprime + previsualiza
 * localmente (sin red) — el upload real pasa a ser parte del submit (ver
 * `summary-step.tsx`), porque MOVO-81 presigna contra `POST
 * /shipments/:id/photos/presign`, que necesita un `id` de envío que todavía no existe
 * durante el wizard. */
export function isPhotosStepValid(state: { photos: WizardPhoto[] }): boolean {
  return state.photos.filter((p) => p.status === "uploaded").length >= REQUIRED_PHOTO_COUNT;
}

const SLOT_LABELS = ["Foto 1 del paquete", "Foto 2 del paquete"];

export function PhotosStep() {
  const { photos, addPhoto, updatePhoto, removePhoto } = useShipmentWizardStore();

  async function captureInto(existingId?: string) {
    const result = await takePhotoWithCamera();
    if (result.permissionDenied || result.cancelled || !result.uri) return;

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

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <Camera size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">Fotos del paquete</Text>
        <Text className="font-sans text-body text-fg-2">
          Sacá 2 fotos como evidencia del estado inicial — las vamos a comprimir antes de subirlas.
        </Text>
      </View>

      <View className="gap-3">
        {SLOT_LABELS.map((slotLabel, index) => {
          const photo = photos[index];
          return (
            <PhotoSlot
              key={photo?.id ?? `empty-${index}`}
              testID={`photos-step-slot-${index}`}
              photo={photo}
              label={slotLabel}
              onCapture={() => captureInto()}
              onRetry={() => captureInto(photo?.id)}
              onRemove={() => photo && removePhoto(photo.id)}
            />
          );
        })}
      </View>
    </View>
  );
}
