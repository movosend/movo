import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { ChevronRight, MessageCircle } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { chatReadOnlyCopy } from "../../src/lib/chat-format";

export interface ChatAccessCardProps {
  shipmentId: string;
  /** `read_only`: el envío ya se entregó, la conversación se puede leer pero no escribir. */
  availability: "open" | "read_only";
  /** Estado del envío y si quien mira es el receptor original: deciden el texto de solo lectura. */
  status?: ShipmentStatus;
  isFormerReceiver?: boolean;
  testID?: string;
}

/**
 * MOVO-284: acceso al "Chat del envío" desde el detalle, para las tres partes. Mismo lenguaje que `LiveTrackingCard`
 * y `OffersBanner` (borde, ícono en cuadrado de 42, título de 15 y subtítulo de 12). Con el chat abierto el ícono
 * va en el lima de marca; en solo lectura, apagado.
 */
export function ChatAccessCard({ shipmentId, availability, status, isFormerReceiver = false, testID }: ChatAccessCardProps) {
  const colors = useThemeColors();
  const open = availability === "open";

  return (
    <Pressable
      testID={testID ?? "chat-access-card"}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push(`/(app)/shipments/${shipmentId}/chat`);
      }}
      className={`flex-row items-center gap-3 rounded-[12px] border bg-bg-mute px-4 py-3.5 active:bg-bg-mute/80 ${open ? "border-fg/30" : "border-transparent"}`}
      accessibilityRole="button"
      accessibilityLabel={open ? "Abrir el chat del envío" : "Ver la conversación del envío"}
    >
      <View className={`h-[42px] w-[42px] items-center justify-center rounded-[10px] ${open ? "bg-lime-500" : "bg-fg/10"}`}>
        <MessageCircle size={18} color={open ? "#0A0A0B" : colors.fg3} strokeWidth={1.8} />
      </View>
      <View className="flex-1">
        <Text className={`font-sans-semibold text-[15px] ${open ? "text-fg" : "text-fg-2"}`}>Chat del envío</Text>
        <Text className="mt-0.5 font-sans text-[12px] text-fg-3">
          {open
            ? "Coordiná el retiro y la entrega con las otras partes."
            : chatReadOnlyCopy({ archived: false, status, isFormerReceiver })}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.fg3} strokeWidth={2} />
    </Pressable>
  );
}
