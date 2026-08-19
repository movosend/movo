import { ActivityIndicator, Text, View } from "react-native";
import { PackageX, WifiOff } from "lucide-react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useRecentShipments } from "../../src/hooks/use-shipments";
import { ShipmentRow } from "../shipments/shipment-row";
import { GradientBorderCard } from "../ui/gradient-border-card";

/**
 * Sección "Actividad reciente" de Inicio (MOVO-83): vista previa de los últimos 3
 * envíos propios (`GET /shipments/mine`, MOVO-80 backend — ya Done aunque el wizard de
 * creación todavía no exista, así que hoy esta sección arranca siempre en el estado
 * vacío para cualquier usuario real, y eso es esperado).
 *
 * Mismo lenguaje visual "chrome" que `ProfileStatsRow` (`GradientBorderCard`
 * compartido) — no es una lista nueva de la nada, es la misma familia de card que ya
 * usa el perfil. El acceso al listado completo ("Mis Envíos") vive fuera de esta card,
 * en `ViewAllShipmentsLink` (MOVO-127, feedback post-QA: separarlo de acá para no
 * competir con el resto del contenido de la card).
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
