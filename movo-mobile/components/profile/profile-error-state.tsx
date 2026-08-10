import { WifiOff } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../auth/primary-button";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface ProfileErrorStateProps {
  message: string;
  onRetry: () => void;
  testID?: string;
}

/** Estado de error de red del perfil, con reintentar (MOVO-78 AC8). */
export function ProfileErrorState({ message, onRetry, testID }: ProfileErrorStateProps) {
  const colors = useThemeColors();

  return (
    <SafeAreaView testID={testID} className="flex-1 bg-bg px-8" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center">
        <WifiOff size={32} strokeWidth={1.8} color={colors.fg3} />
        <Text className="mb-2 mt-4 text-center font-sans-semibold text-h3 text-fg">
          No pudimos cargar tu perfil
        </Text>
        <Text className="text-center font-sans text-body text-fg-2">{message}</Text>
      </View>
      <PrimaryButton testID="profile-error-retry" label="Reintentar" onPress={onRetry} />
    </SafeAreaView>
  );
}
