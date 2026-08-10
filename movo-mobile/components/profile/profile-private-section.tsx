import { Lock, Mail, Phone } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatPhoneDisplay } from "../../src/lib/profile-format";

export interface ProfilePrivateSectionProps {
  email: string;
  phone: string;
  testID?: string;
}

/**
 * "TUS DATOS PERSONALES" (MOVO-78 AC3): agrupación explícita de lo que solo el propio
 * usuario puede ver. A propósito **no** es compatible con `PublicProfile` — email y
 * teléfono no existen en esa proyección, y este componente es justamente la pieza que
 * hace visible esa distinción (no un componente genérico que después alguien reusa
 * mal para un perfil público).
 */
export function ProfilePrivateSection({ email, phone, testID }: ProfilePrivateSectionProps) {
  const colors = useThemeColors();

  return (
    <View testID={testID} className="mb-5">
      <View className="mb-2.5 flex-row items-center gap-1.5">
        <Lock size={12} strokeWidth={2} color={colors.fg3} />
        <Text className="font-sans-semibold text-caption uppercase text-fg-3">
          Tus datos personales
        </Text>
      </View>
      <View className="overflow-hidden rounded-[10px] border border-border bg-bg-sub">
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-4">
          <Mail size={18} strokeWidth={1.8} color={colors.fg3} />
          <Text className="flex-1 font-sans text-[15px] text-fg">{email}</Text>
        </View>
        <View className="flex-row items-center gap-3 px-4 py-4">
          <Phone size={18} strokeWidth={1.8} color={colors.fg3} />
          <Text className="flex-1 font-sans text-[15px] text-fg">
            {formatPhoneDisplay(phone)}
          </Text>
        </View>
      </View>
    </View>
  );
}
