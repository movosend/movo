import { Package, PackageX, WifiOff } from "lucide-react-native";
import { ActivityIndicator, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useRecentShipments } from "../../src/hooks/use-shipments";
import {
  formatShipmentPrice,
  shipmentStatusLabel,
  shipmentStatusTone,
} from "../../src/lib/shipment-format";
import { GradientBorderCard } from "../ui/gradient-border-card";

const TONE_BADGE_CLASS: Record<"success" | "warning" | "danger" | "info" | "neutral", string> = {
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
  info: "bg-info-100 text-info-700",
  neutral: "bg-bg-mute text-fg-2",
};

function ShipmentRow({
  shipment,
  isFirst,
  testID,
}: {
  shipment: ShipmentSummary;
  isFirst: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const tone = shipmentStatusTone(shipment.status);
  const [badgeBg, badgeText] = TONE_BADGE_CLASS[tone].split(" ");

  return (
    <View
      testID={testID}
      className={`flex-row items-center gap-3 py-3 ${isFirst ? "" : "border-t border-border"}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute">
        <Package size={16} strokeWidth={1.8} color={colors.fg3} />
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans-medium text-small text-fg">
          {shipment.deliveryAddress}
        </Text>
        <Text className="mt-0.5 font-sans text-caption text-fg-3">
          {formatShipmentPrice(shipment.agreedPriceArs, shipment.suggestedPriceArs)}
        </Text>
      </View>
      <View className={`rounded-full px-2.5 py-1 ${badgeBg}`}>
        <Text className={`font-sans-medium text-[11px] ${badgeText}`}>
          {shipmentStatusLabel(shipment.status)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Sección "Actividad reciente" de Inicio (MOVO-83): vista previa de los últimos 3
 * envíos propios (`GET /shipments/mine`, MOVO-80 backend — ya Done aunque el wizard de
 * creación todavía no exista, así que hoy esta sección arranca siempre en el estado
 * vacío para cualquier usuario real, y eso es esperado).
 *
 * Mismo lenguaje visual "chrome" que `ProfileStatsRow` (`GradientBorderCard`
 * compartido) — no es una lista nueva de la nada, es la misma familia de card que ya
 * usa el perfil.
 */
export function RecentShipmentsSection({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const { data, isLoading, isError, refetch } = useRecentShipments();

  return (
    <GradientBorderCard
      testID={testID}
      fillColors={colors.chromeOuterGradient}
      borderColors={colors.chromeOuterBorderGradient}
      borderRadius={20}
      borderWidth={1.5}
      style={{
        shadowColor: colors.chromeShadow,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 1,
        shadowRadius: 10,
        elevation: 4,
      }}
    >
      <View style={{ padding: 14 }}>
        <Text className="mb-1 font-sans-medium text-caption uppercase text-fg-3">
          Actividad reciente
        </Text>

        {isLoading ? (
          <View className="items-center justify-center py-8">
            <ActivityIndicator color={colors.fg3} />
          </View>
        ) : isError ? (
          <View className="items-center gap-2 py-6">
            <WifiOff size={20} strokeWidth={1.8} color={colors.fg3} />
            <Text className="text-center font-sans text-small text-fg-2">
              No pudimos cargar tus envíos.
            </Text>
            <Text onPress={() => refetch()} className="font-sans-medium text-small text-fg">
              Reintentar
            </Text>
          </View>
        ) : !data || data.items.length === 0 ? (
          <View className="items-center gap-2 py-6">
            <PackageX size={20} strokeWidth={1.8} color={colors.fg3} />
            <Text className="text-center font-sans text-small text-fg-2">
              Todavía no hiciste ningún envío.
            </Text>
          </View>
        ) : (
          <View>
            {data.items.map((shipment, index) => (
              <ShipmentRow key={shipment.id} shipment={shipment} isFirst={index === 0} />
            ))}
          </View>
        )}
      </View>
    </GradientBorderCard>
  );
}
