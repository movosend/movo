import { Repeat } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatRecurrenceBadge } from "../../src/lib/trip-recurrence";

/**
 * Badge de serie de un viaje recurrente (MOVO-266, AC3): ícono `Repeat` + "Todos los
 * viernes"/"Lun y vie"/"Lun, mié y vie". En el detalle es el pill `ink-100`/`ink-600` del
 * diseño; en la card de "Mis viajes" el diseño lo muestra como texto suelto. En modo
 * oscuro pasa a los tokens semánticos (la escala `ink` fija no invierte). El ícono usa `fg2`,
 * que en claro es exactamente `ink-600`.
 */
export function TripRecurrenceBadge({
  weekdays,
  variant = "pill",
  testID,
}: {
  weekdays: readonly number[];
  /** `inline`: ícono + texto sin fondo, como en la card "Horario" de "Mis viajes". */
  variant?: "pill" | "inline";
  testID?: string;
}) {
  const colors = useThemeColors();
  if (variant === "inline") {
    return (
      <View testID={testID} className="min-w-0 shrink flex-row items-center gap-1">
        <Repeat size={12} color={colors.fg3} strokeWidth={2} />
        <Text className="font-sans-medium text-[11px] text-fg-3" numberOfLines={1}>
          {formatRecurrenceBadge(weekdays)}
        </Text>
      </View>
    );
  }
  return (
    <View
      testID={testID}
      className="h-6 flex-row items-center gap-1.5 self-start rounded-full bg-ink-100 px-[9px] dark:bg-bg-mute"
    >
      <Repeat size={13} color={colors.fg2} strokeWidth={2} />
      <Text className="font-sans-medium text-[12px] text-ink-600 dark:text-fg-2">{formatRecurrenceBadge(weekdays)}</Text>
    </View>
  );
}
