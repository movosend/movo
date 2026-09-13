import { ActivityIndicator, Text, View } from "react-native";
import { PackageX, WifiOff } from "lucide-react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useRecentShipments } from "../../src/hooks/use-shipments";
import { shipmentLifecycleStage } from "../../src/lib/shipment-format";
import { ShipmentRow } from "../shipments/shipment-row";
import { ViewAllShipmentsLink } from "./view-all-shipments-link";

/**
 * Sección "Actividad reciente" de Inicio (MOVO-83): vista previa de los últimos 3
 * envíos propios (`GET /shipments/mine`, MOVO-80 backend).
 *
 * Formato lista (fusión de MOVO-113 con un mockup de referencia): sin card/chrome
 * contenedor — un label de sección, una línea divisoria fina, y filas separadas por
 * bordes finos, terminando en "Ver todos mis envíos" como último ítem de la misma
 * lista (`ViewAllShipmentsLink`, ya no una sección aparte debajo).
 */
export function RecentShipmentsSection({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const { data, isLoading, isError, refetch } = useRecentShipments();

  const activeCount = data
    ? data.items.filter((s) => shipmentLifecycleStage(s.status) === "ongoing").length
    : 0;

  return (
    <View testID={testID}>
      {/* ── Encabezado ── */}
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="font-sans-medium text-caption uppercase text-fg-3">
          Actividad reciente
        </Text>

        {activeCount > 0 ? (
          <View className="flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full bg-lime-500" />
            <Text className="font-sans-medium text-caption uppercase text-fg-2">
              {activeCount} {activeCount === 1 ? "activo" : "activos"}
            </Text>
          </View>
        ) : null}
      </View>
      <View className="mb-1 h-px w-full bg-border" />

      {/* ── Contenido ── */}
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
            <ShipmentRow
              key={shipment.id}
              shipment={shipment}
              isFirst={index === 0}
              testID={`shipment-row-${shipment.id}`}
            />
          ))}
        </View>
      )}

      <ViewAllShipmentsLink testID={testID ? `${testID}-view-all` : undefined} />
    </View>
  );
}
