import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { ToggleSwitch } from "../ui/toggle-switch";

interface NotificationCategoryRowProps {
  title: string;
  sub: string;
  /** `false` = catálogo de MOVO-240 sin trigger real todavía (AC3: se muestra sin
   * toggle funcional). */
  implemented: boolean;
  enabled: boolean;
  /** Toggle maestro apagado: la fila se atenúa pero sigue navegable/tocable (ver
   * `ToggleSwitch`). */
  dimmed: boolean;
  /** Permiso del SO bloqueado: el toggle de esta fila queda deshabilitado (no solo
   * atenuado) — un toggle que no puede tener efecto real no debería parecer que sí. */
  permissionBlocked: boolean;
  onToggle: (next: boolean) => void;
  onPress: () => void;
  testID?: string;
}

export function NotificationCategoryRow({
  title,
  sub,
  implemented,
  enabled,
  dimmed,
  permissionBlocked,
  onToggle,
  onPress,
  testID,
}: NotificationCategoryRowProps) {
  const colors = useThemeColors();
  const toggleDisabled = !implemented || permissionBlocked;
  const toggleDimmed = dimmed || !implemented;

  return (
    <View testID={testID} className="border-b border-border py-3.5">
      <View className="flex-row items-center gap-4">
        <Pressable testID={testID ? `${testID}-open` : undefined} onPress={onPress} className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text
              className={`font-sans-medium text-body ${implemented ? "text-fg" : "text-fg-2"}`}
              numberOfLines={1}
            >
              {title}
            </Text>
            {!implemented ? (
              <View testID={testID ? `${testID}-pending` : undefined} className="rounded-full bg-bg-mute px-2 py-0.5">
                <Text className="font-sans-semibold text-[10px] uppercase tracking-wider text-fg-3">Pronto</Text>
              </View>
            ) : null}
            <ChevronRight size={15} strokeWidth={2} color={colors.fg3} />
          </View>
          <Text className={`mt-0.5 font-sans text-small ${implemented ? "text-fg-3" : "text-fg-2"}`} numberOfLines={2}>
            {sub}
          </Text>
        </Pressable>
        <ToggleSwitch
          value={implemented && enabled}
          onChange={onToggle}
          disabled={toggleDisabled}
          dimmed={toggleDimmed}
          testID={testID ? `${testID}-toggle` : undefined}
        />
      </View>
    </View>
  );
}
