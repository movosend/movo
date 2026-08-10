import * as Haptics from "expo-haptics";
import { LogOut } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text } from "react-native";

export interface ProfileLogoutButtonProps {
  onPress: () => void;
  loading?: boolean;
  testID?: string;
}

/** Acción de logout desde el perfil (MOVO-78 AC7). */
export function ProfileLogoutButton({ onPress, loading, testID }: ProfileLogoutButtonProps) {
  return (
    <Pressable
      testID={testID}
      disabled={loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className="flex-row items-center justify-center gap-2 rounded-full bg-danger-100 py-3.5"
    >
      {loading ? (
        <ActivityIndicator color="#C22F35" />
      ) : (
        <LogOut size={16} strokeWidth={2} color="#C22F35" />
      )}
      <Text className="font-sans-semibold text-body text-danger-600">Cerrar sesión</Text>
    </Pressable>
  );
}
