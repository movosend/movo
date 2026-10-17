import { ChevronRight, History } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/**
 * Fila de entrada al historial de pagos y cobros (MOVO-304 AC1), arriba de "Pagos y cobros"
 * (canvas "1 · Entrada"). Es una pieza aparte: no toca la sección de tarjetas de MOVO-101.
 */
export function HistoryEntryRow({ onPress }: { onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID="payments-history-entry"
      accessibilityRole="button"
      accessibilityLabel="Historial de pagos y cobros"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl border-[1.5px] border-fg bg-bg-sub p-4 active:bg-bg-mute"
    >
      {/* El círculo lima lleva siempre el ícono oscuro: sobre lima el color del tema no contrasta en modo oscuro. */}
      <View className="h-10 w-10 items-center justify-center rounded-full bg-lime-500">
        <History size={20} color="#0A0A0B" strokeWidth={2} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-sans-semibold text-[15px] leading-5 text-fg">Historial de pagos y cobros</Text>
        <Text className="font-sans text-[13px] leading-[18px] text-fg-2">
          Lo que pagaste como emisor y lo que cobraste como transportista.
        </Text>
      </View>
      <ChevronRight size={20} color={colors.fg3} strokeWidth={2} />
    </Pressable>
  );
}
