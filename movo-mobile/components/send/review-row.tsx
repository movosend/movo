import { CircleCheck, Pencil } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface ReviewRowProps {
  label: string;
  value: string;
  badge?: string;
  onEdit: () => void;
  last?: boolean;
  testID?: string;
}

/** Extraído del patrón inline `ReviewRow` de `app/(auth)/register.tsx` (paso de
 * revisión del wizard de registro) — ahora componente compartido real, reusado por el
 * paso de resumen del wizard de envíos (MOVO-83). */
export function ReviewRow({ label, value, badge, onEdit, last, testID }: ReviewRowProps) {
  const colors = useThemeColors();

  return (
    <View
      testID={testID}
      className={`flex-row items-center justify-between gap-2.5 px-4 py-3.5 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <View className="flex-1">
        <Text className="mb-0.5 font-sans text-[11px] text-fg-3">{label}</Text>
        <View className="flex-row items-center gap-1.5">
          <Text className="font-sans-medium text-[14px] text-fg">{value || "—"}</Text>
          {badge ? (
            <View className="flex-row items-center gap-1">
              <CircleCheck size={14} color="#2BB673" strokeWidth={2} fill="none" />
              <Text className="font-sans-semibold text-[12px] text-success-500">{badge}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Pressable
        testID={testID ? `${testID}-edit` : `review-edit-${label}`}
        onPress={onEdit}
        hitSlop={8}
        className="h-7 w-7 items-center justify-center"
      >
        <Pencil size={16} color={colors.fg2} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}
