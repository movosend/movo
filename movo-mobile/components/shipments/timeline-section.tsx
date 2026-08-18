import { Hourglass } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface TimelineSectionProps {
  testID?: string;
}

/**
 * AC6 de MOVO-127, bloqueado parcialmente: `GET /shipments/:id/events` (MOVO-128) no
 * existe todavía, así que acá solo hay un estado vacío explícito — nunca se inventan
 * timestamps ni se arma una línea de tiempo a partir de `status`/`lastStatusChangedAt`
 * (perdería todos los pasos intermedios). Punto de extensión cuando MOVO-128 exista:
 * reemplazar este componente por uno que consuma ese endpoint, mismo criterio que
 * AC6 de MOVO-107 (push → detalle de envío) documentado en `movo-mobile/CLAUDE.md`.
 */
export function TimelineSection({ testID }: TimelineSectionProps) {
  const colors = useThemeColors();

  return (
    <View
      testID={testID}
      className="items-center gap-2 rounded-[14px] border border-dashed border-border-strong bg-bg-sub px-4 py-6"
    >
      <Hourglass size={20} color={colors.fg3} strokeWidth={1.8} />
      <Text className="text-center font-sans-medium text-[13px] text-fg-3">
        Línea de tiempo próximamente
      </Text>
    </View>
  );
}
