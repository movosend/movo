import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, MapPin, Package } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../../components/auth/primary-button";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useShipment } from "../../../src/hooks/use-shipments";
import {
  formatShipmentPrice,
  shipmentStatusLabel,
  shipmentStatusTone,
} from "../../../src/lib/shipment-format";

const TONE_BADGE_CLASS: Record<"success" | "warning" | "danger" | "info" | "neutral", string> = {
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
  info: "bg-info-100 text-info-700",
  neutral: "bg-bg-mute text-fg-2",
};

/**
 * Detalle de un envío propio — todavía un placeholder mínimo (solo lo que ya expone
 * `GET /shipments/:id`, MOVO-80): destino de "Ver envío" al terminar de publicar
 * (`PublishShipmentButton`, MOVO-83). El detalle real (tracking en vivo, timeline de
 * eventos, handshake) es un ticket aparte, sin arrancar todavía — a propósito no se
 * inventa ninguna sección que no tenga datos reales atrás.
 */
export default function ShipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { data: shipment, isLoading, isError, refetch } = useShipment(id);

  const tone = shipment ? shipmentStatusTone(shipment.status) : "neutral";
  const [badgeBg, badgeText] = TONE_BADGE_CLASS[tone].split(" ");

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="shipment-detail-back"
          onPress={() => router.replace("/(app)/(tabs)/home")}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Tu envío</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.fg3} />
        </View>
      ) : isError || !shipment ? (
        <View className="px-5 pt-2">
          <ErrorBanner testID="shipment-detail-error" message="No pudimos cargar este envío." />
          <Text onPress={() => refetch()} className="mt-3 font-sans-medium text-small text-fg">
            Reintentar
          </Text>
        </View>
      ) : (
        <View className="flex-1 justify-between">
          <View className="gap-5 px-5 pt-2">
            <View className="flex-row items-center justify-between">
              <View className="h-12 w-12 items-center justify-center rounded-[12px] bg-lime-200">
                <Package size={22} color="#0A0A0B" strokeWidth={1.8} />
              </View>
              <View className={`rounded-full px-3 py-1.5 ${badgeBg}`}>
                <Text className={`font-sans-medium text-[12px] ${badgeText}`}>
                  {shipmentStatusLabel(shipment.status)}
                </Text>
              </View>
            </View>

            <View className="overflow-hidden rounded-[14px] border border-border">
              <View className="flex-row items-start gap-3 border-b border-border px-4 py-3.5">
                <MapPin size={16} color="#0A0A0B" strokeWidth={1.8} style={{ marginTop: 2 }} />
                <View className="flex-1">
                  <Text className="mb-0.5 font-sans text-[11px] text-fg-3">Retiro</Text>
                  <Text className="font-sans-medium text-[15px] text-fg">{shipment.pickupAddress}</Text>
                </View>
              </View>
              <View className="flex-row items-start gap-3 px-4 py-3.5">
                <MapPin size={16} color="#2B6BFF" strokeWidth={1.8} style={{ marginTop: 2 }} />
                <View className="flex-1">
                  <Text className="mb-0.5 font-sans text-[11px] text-fg-3">Entrega</Text>
                  <Text className="font-sans-medium text-[15px] text-fg">{shipment.deliveryAddress}</Text>
                </View>
              </View>
            </View>

            <View className="flex-row items-center justify-between rounded-[14px] border border-border px-4 py-3.5">
              <Text className="font-sans text-body text-fg-2">
                {shipment.pickupDate} · {shipment.pickupTimeWindowStart} a {shipment.pickupTimeWindowEnd}
              </Text>
              <Text className="font-sans-semibold text-[17px] text-fg">
                {formatShipmentPrice(shipment.agreedPriceArs, shipment.suggestedPriceArs)}
              </Text>
            </View>
          </View>

          <PrimaryButton
            testID="shipment-detail-home"
            label="Volver a Inicio"
            onPress={() => router.replace("/(app)/(tabs)/home")}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
