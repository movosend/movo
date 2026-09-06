import { ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";

export interface ProfileVerifiedBadgeProps {
  testID?: string;
  /** MOVO-177 (feedback de UI): sufijo opcional tras "Identidad verificada" — usado
   * por la card "Con quién tratás" (`transport/[id].tsx`) para sumar la reputación
   * ("· 4,9 en 34 envíos") sin duplicar el ícono/texto base en otro componente. */
  suffix?: string;
}

/**
 * Insignia de identidad verificada (MOVO-78), integrada debajo del nombre en el
 * header en vez de un chip genérico dentro de `ProfileBadges` — se le da lugar
 * propio pegado a la identidad del usuario en vez de tratarla como una más de una
 * lista de chips (`license_verified`, MOVO-15, sí queda como chip genérico en
 * `ProfileBadges`: no está pegada al nombre de la misma forma).
 */
export function ProfileVerifiedBadge({ testID, suffix }: ProfileVerifiedBadgeProps) {
  return (
    <View testID={testID} className="mt-1 flex-row items-center gap-1">
      <ShieldCheck size={13} strokeWidth={2.2} color="#1F9760" />
      <Text className="font-sans-medium text-[12px] text-success-600">
        Identidad verificada{suffix ? ` · ${suffix}` : ""}
      </Text>
    </View>
  );
}
