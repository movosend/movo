import { Camera, Check, RotateCcw, X } from "lucide-react-native";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { EvidencePhoto } from "../../src/hooks/use-evidence-photos";

interface PhotoThumbnailProps {
  photo: EvidencePhoto;
  onRetry: () => void;
  onRemove: () => void;
  size: number;
  testID?: string;
}

/**
 * Una celda del grid de evidencia (MOVO-197), cuadrada — mismo lenguaje visual que
 * `PhotoSlot` (`components/send/photo-slot.tsx`, MOVO-83) pero sin acoplarse a
 * `WizardPhoto`/el store del wizard de creación: reusable desde cualquier wizard que
 * monte `EvidenceCaptureStep`. Sin botón de borrar una vez `uploaded` — no existe
 * `DELETE` de fotos en el backend (MOVO-196), así que una foto ya confirmada contra
 * S3/DB queda fija (recorte de AC7 confirmado explícitamente para esta US).
 */
export function PhotoThumbnail({ photo, onRetry, onRemove, size, testID }: PhotoThumbnailProps) {
  const colors = useThemeColors();

  if (photo.status === "error") {
    return (
      <View
        testID={testID}
        style={{ width: size, height: size }}
        className="items-center justify-center gap-2 rounded-[10px] border border-dashed border-danger-300 bg-danger-100 p-2"
      >
        <Camera size={18} color={colors.fg2} strokeWidth={1.8} />
        <View className="flex-row gap-1.5">
          <Pressable
            testID={testID ? `${testID}-retry` : undefined}
            onPress={onRetry}
            hitSlop={6}
            className="h-6 w-6 items-center justify-center rounded-full border border-border-strong"
          >
            <RotateCcw size={11} color={colors.fg1} strokeWidth={2} />
          </Pressable>
          <Pressable
            testID={testID ? `${testID}-remove` : undefined}
            onPress={onRemove}
            hitSlop={6}
            className="h-6 w-6 items-center justify-center rounded-full border border-border-strong"
          >
            <X size={11} color={colors.fg1} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>
    );
  }

  const isBusy = photo.status === "compressing" || photo.status === "uploading";

  return (
    <View testID={testID} style={{ width: size, height: size }} className="relative overflow-hidden rounded-[10px] border border-border">
      <Image source={{ uri: photo.localUri }} className="h-full w-full" resizeMode="cover" />
      {isBusy ? (
        <View className="absolute inset-0 items-center justify-center gap-1 bg-black/40">
          <ActivityIndicator color="#fff" />
          {photo.status === "uploading" ? (
            <Text className="font-mono text-[11px] text-white">{photo.progress}%</Text>
          ) : null}
        </View>
      ) : (
        <View className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-black/55">
          <Check size={13} color="#fff" strokeWidth={2.6} />
        </View>
      )}
    </View>
  );
}
