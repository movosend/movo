import { ActivityIndicator, Text, View } from "react-native";
import { PackageX, WifiOff } from "lucide-react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useRecentShipments } from "../../src/hooks/use-shipments";
import { shipmentLifecycleStage } from "../../src/lib/shipment-format";
import { ShipmentRow } from "../shipments/shipment-row";
import { GradientBorderCard } from "../ui/gradient-border-card";

/**
 * Sección "Actividad reciente" de Inicio (MOVO-83): vista previa de los últimos 3
 * envíos propios (`GET /shipments/mine`, MOVO-80 backend).
 *
 * Diseño 1-a: encabezado con label izquierdo, contador de activos con dot verde al
 * centro (oculto si hay 0 activos), y link "Ver todos" a la derecha integrado en el
 * mismo card — reemplaza al componente externo `ViewAllShipmentsLink` (MOVO-127).
 *
 * Diseño 1-b para cada fila: `ShipmentRow` con icono direccional, timestamp secundario
 * y pill de estado.
 */
export function RecentShipmentsSection({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const { data, isLoading, isError, refetch } = useRecentShipments();

  const activeCount = data
    ? data.items.filter((s) => shipmentLifecycleStage(s.status) === "ongoing").length
    : 0;

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
        {/* ── Encabezado 1-a ── */}
        <View className="mb-3 flex-row items-center justify-between">
          {/* Label izquierdo */}
          <Text className="font-sans-medium text-caption uppercase text-fg-3">
            Actividad reciente
          </Text>

          {/* Contador de activos (solo si hay al menos 1) */}
          {activeCount > 0 ? (
            <View className="flex-row items-center gap-1.5">
              <View className="h-1.5 w-1.5 rounded-full bg-lime-500" />
              <Text className="font-sans-medium text-caption uppercase text-fg-2">
                {activeCount} {activeCount === 1 ? "activo" : "activos"}
              </Text>
            </View>
          ) : null}
        </View>

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
      </View>
    </GradientBorderCard>
  );
}

