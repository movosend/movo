import { CheckCircle2 } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { SUPPORT_RESOLVED_COPY } from "../../src/lib/support-format";

/** MOVO-324: cartel de consulta resuelta, con el estilo de `ModerationBanner` pero sin cerrar (el campo sigue habilitado). */
export function ResolvedBanner({ visible }: { visible: boolean }) {
  const colors = useThemeColors();
  if (!visible) return null;
  return (
    <View testID="support-resolved-banner" className="mx-4 mb-2 flex-row items-start gap-2.5 rounded-[12px] border border-border-strong bg-bg-sub px-3.5 py-3">
      <CheckCircle2 size={18} color={colors.fg1} strokeWidth={2} />
      <Text className="flex-1 font-sans text-small text-fg-2">{SUPPORT_RESOLVED_COPY}</Text>
    </View>
  );
}
