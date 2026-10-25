import { ImagePlus } from "lucide-react-native";
import { Pressable } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/** MOVO-324: botón de fotos a la izquierda del campo de la conversación. */
export function AttachPhotoButton({ onPress, disabled, testID }: { onPress: () => void; disabled?: boolean; testID?: string }) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Adjuntar foto"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className="items-center justify-center"
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong, opacity: disabled ? 0.4 : 1 }}
    >
      <ImagePlus size={20} color={colors.fg1} strokeWidth={1.9} />
    </Pressable>
  );
}
