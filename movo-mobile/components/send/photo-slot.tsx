import { Camera, Plus, RotateCcw, X } from "lucide-react-native";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { WizardPhoto } from "../../src/store/shipment-wizard-store";

interface AddPhotoTileProps {
  onPress: () => void;
  /** Lado del cuadrado en px, medido por el grid (`photos-step.tsx#onLayout`).
   * `w-[30%]` + `aspectRatio: 1` se ve bien con más celdas al lado, pero Yoga no
   * resuelve el aspect ratio de forma confiable cuando esta es la única celda del
   * `flex-wrap` (la celda queda con el alto de su contenido, no cuadrada) — un
   * tamaño en píxeles explícito, calculado a partir del ancho real del grid, no
   * depende de cuántas celdas más haya al lado. */
  size: number;
  testID?: string;
}

/** Última celda del grid (AC6): agrega la próxima foto del paquete, sin límite de
 * slots fijos — reemplaza los dos dropzones nombrados ("Foto 1"/"Foto 2") que forzaban
 * exactamente 2 fotos. Ícono compuesto (cámara + badge "+") — lucide-react-native no
 * tiene un ícono "cámara con más" dedicado. */
export function AddPhotoTile({ onPress, size, testID }: AddPhotoTileProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{ width: size, height: size }}
      className="items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border-strong bg-bg-sub"
    >
      <View>
        <Camera size={22} color={colors.fg2} strokeWidth={1.8} />
        <View className="absolute -bottom-1 -right-1 h-3.5 w-3.5 items-center justify-center rounded-full bg-fg">
          <Plus size={9} color={colors.bg} strokeWidth={3} />
        </View>
      </View>
      <Text className="font-sans-medium text-[11px] text-fg-2">Agregar</Text>
    </Pressable>
  );
}

interface PhotoSlotProps {
  photo: WizardPhoto;
  onRetry: () => void;
  onRemove: () => void;
  /** Ver `AddPhotoTileProps.size`. */
  size: number;
  testID?: string;
}

/** Una celda del grid de fotos del paquete (AC6/AC12), cuadrada. Estados:
 * `compressing` → `ready` (preview local, la subida real a S3 pasa a ser parte del
 * submit — ver `summary-step.tsx`), o `error` con reintento sin perder el resto del
 * wizard. */
export function PhotoSlot({ photo, onRetry, onRemove, size, testID }: PhotoSlotProps) {
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

  const isCompressing = photo.status === "compressing";

  return (
    <View
      testID={testID}
      style={{ width: size, height: size }}
      className="relative overflow-hidden rounded-[10px] border border-border"
    >
      <Image source={{ uri: photo.localUri }} className="h-full w-full" resizeMode="cover" />
      {isCompressing ? (
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <Pressable
          testID={testID ? `${testID}-remove` : undefined}
          onPress={onRemove}
          hitSlop={8}
          className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-black/55"
        >
          <X size={13} color="#fff" strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  );
}
