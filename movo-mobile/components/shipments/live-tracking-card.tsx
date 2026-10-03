import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { ChevronRight, Radio } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { LiveTrackingAvailability } from "../../src/lib/shipment-format";

export interface LiveTrackingCardProps {
  shipmentId: string;
  availability: LiveTrackingAvailability;
  testID?: string;
}

/**
 * Acceso a "Seguimiento en vivo" (MOVO-204) desde el detalle del envío, para emisor y
 * receptor. Rediseño de MOVO-271 (AC3): mismo lenguaje que `OffersBanner`, la otra
 * card de acceso de esta pantalla (borde, ícono en cuadrado de 42, título de 15 y
 * subtítulo de 12), con el lime de marca y la pastilla "EN VIVO" de `MyShipmentRow`
 * en vez de colores sueltos.
 *
 * `pending` (AC5): el transportista todavía no empezó el recorrido, así que la card no
 * navega y explica cuándo se va a habilitar. Qué estado corresponde lo decide
 * `liveTrackingAvailability` (`shipment-format.ts`), no esta card.
 */
export function LiveTrackingCard({ shipmentId, availability, testID }: LiveTrackingCardProps) {
  const colors = useThemeColors();
  const id = testID ?? "live-tracking-card";

  if (availability === "pending") {
    return (
      <View
        testID={`${id}-pending`}
        className="flex-row items-center gap-3 rounded-[12px] border border-transparent bg-bg-mute px-4 py-3.5"
        accessibilityLabel="Seguimiento en vivo, todavía no disponible"
      >
        <View className="h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-fg/10">
          <Radio size={18} color={colors.fg3} strokeWidth={1.8} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[15px] text-fg-2">Seguimiento en vivo</Text>
          <Text testID={`${id}-pending-text`} className="mt-0.5 font-sans text-[12px] text-fg-3">
            Cuando el transportista inicie el recorrido, vas a poder ver su ubicación en tiempo real.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      testID={id}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push(`/(app)/shipments/${shipmentId}/tracking`);
      }}
      className="flex-row items-center gap-3 rounded-[12px] border border-fg/30 bg-bg-mute px-4 py-3.5 active:bg-bg-mute/80"
      accessibilityRole="button"
      accessibilityLabel="Ver seguimiento en vivo en el mapa"
    >
      <View className="h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-lime-500">
        <Radio size={18} color="#0A0A0B" strokeWidth={1.8} />
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-sans-semibold text-[15px] text-fg">Seguimiento en vivo</Text>
          <View className="h-[20px] flex-row items-center gap-1 rounded-full bg-[#EEFCBF] px-2">
            <View className="h-1.5 w-1.5 rounded-full bg-[#6E8E1E]" />
            <Text className="font-sans-semibold text-[10px] tracking-[0.6px] text-[#6E8E1E]">EN VIVO</Text>
          </View>
        </View>
        <Text className="mt-0.5 font-sans text-[12px] text-fg-3">
          Mirá en el mapa dónde está el transportista
        </Text>
      </View>

      <ChevronRight size={18} color={colors.fg3} />
    </Pressable>
  );
}
