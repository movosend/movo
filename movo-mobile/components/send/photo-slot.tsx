import { Camera, RotateCcw, X } from "lucide-react-native";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { WizardPhoto } from "../../src/store/shipment-wizard-store";

interface PhotoSlotProps {
  photo: WizardPhoto | undefined;
  label: string;
  onCapture: () => void;
  onRetry: () => void;
  onRemove: () => void;
  testID?: string;
}

/** Dropzone de una foto obligatoria del wizard de envíos (AC6/AC12). Estados:
 * vacío → `compressing` → `uploaded` (preview local, la subida real pasa a ser parte
 * del submit — ver `photos-step.tsx`), o `error` con reintento sin perder el resto del
 * wizard. */
export function PhotoSlot({ photo, label, onCapture, onRetry, onRemove, testID }: PhotoSlotProps) {
  const colors = useThemeColors();

  if (!photo) {
    return (
      <Pressable
        testID={testID}
        onPress={onCapture}
        className="items-center gap-2.5 rounded-[10px] border border-dashed border-border-strong bg-bg-sub px-5 py-6"
      >
        <View className="h-11 w-11 items-center justify-center rounded-full bg-bg-mute">
          <Camera size={20} color={colors.fg2} strokeWidth={1.8} />
        </View>
        <View className="items-center">
          <Text className="font-sans-semibold text-[14px] text-fg">{label}</Text>
          <Text className="mt-0.5 text-center font-sans text-[12px] text-fg-3">
            Queda como evidencia del estado inicial
          </Text>
        </View>
      </Pressable>
    );
  }

  if (photo.status === "error") {
    return (
      <View
        testID={testID}
        className="items-center gap-2.5 rounded-[10px] border border-dashed border-danger-300 bg-danger-100 px-5 py-6"
      >
        <Text className="text-center font-sans text-[13px] text-ink-950">
          {photo.errorMessage ?? "No se pudo procesar la foto."}
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            testID={testID ? `${testID}-retry` : undefined}
            onPress={onRetry}
            className="flex-row items-center gap-1.5 rounded-full border border-border-strong px-3 py-1.5"
          >
            <RotateCcw size={13} color={colors.fg1} strokeWidth={2} />
            <Text className="font-sans-medium text-[12px] text-fg">Reintentar</Text>
          </Pressable>
          <Pressable
            testID={testID ? `${testID}-remove` : undefined}
            onPress={onRemove}
            className="items-center justify-center rounded-full border border-border-strong px-3 py-1.5"
          >
            <Text className="font-sans-medium text-[12px] text-fg">Quitar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const isCompressing = photo.status === "compressing";

  return (
    <View testID={testID} className="relative overflow-hidden rounded-[10px] border border-border">
      <Image source={{ uri: photo.localUri }} className="h-40 w-full" resizeMode="cover" />
      {isCompressing ? (
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <Pressable
          testID={testID ? `${testID}-remove` : undefined}
          onPress={onRemove}
          hitSlop={8}
          className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full bg-black/55"
        >
          <X size={15} color="#fff" strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  );
}
