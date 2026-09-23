import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";

interface OnboardingInfoRowProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}

/** Fila explicativa bajo cada permiso ("Solo al usar la app.", etc.) — mismo lenguaje
 * "glassy oscuro" que el resto del carrusel en los 3 pasos de permiso. */
export function OnboardingInfoRow({ icon: Icon, title, subtitle }: OnboardingInfoRowProps) {
  return (
    <View className="flex-row items-start gap-3 rounded-2xl border border-white/[0.06] bg-ink-800 p-3.5">
      <View className="h-9 w-9 items-center justify-center rounded-lg bg-ink-700">
        <Icon size={18} color="#fff" strokeWidth={2} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-sans-semibold text-small text-paper">{title}</Text>
        <Text className="font-sans text-[13px] leading-[18px] text-ink-400">{subtitle}</Text>
      </View>
    </View>
  );
}
