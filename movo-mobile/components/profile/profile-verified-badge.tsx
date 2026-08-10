import { ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";

export interface ProfileVerifiedBadgeProps {
  testID?: string;
}

/**
 * Insignia de identidad verificada (MOVO-78), integrada debajo del nombre en el
 * header en vez de un chip genérico dentro de `ProfileBadges` — es la única
 * insignia que hoy se calcula de verdad (`license_verified` sigue pendiente de
 * MOVO-15), así que se le da lugar propio pegado a la identidad del usuario en vez
 * de tratarla como una más de una lista de chips.
 */
export function ProfileVerifiedBadge({ testID }: ProfileVerifiedBadgeProps) {
  return (
    <View testID={testID} className="mt-1 flex-row items-center gap-1">
      <ShieldCheck size={13} strokeWidth={2.2} color="#1F9760" />
      <Text className="font-sans-medium text-[12px] text-success-600">Identidad verificada</Text>
    </View>
  );
}
