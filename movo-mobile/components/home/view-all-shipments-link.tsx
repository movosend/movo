import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, Text } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useRecentShipments } from "../../src/hooks/use-shipments";

/**
 * Acceso a "Mis Envíos" — sección propia debajo de `RecentShipmentsSection`, diseño 1-a:
 * fila de ancho completo con borde y fondo `bg-sub`, texto "Ver todos mis envíos" + chevron.
 * Solo se muestra si hay al menos un envío (no tiene sentido "ver todos" sobre una lista vacía).
 *
 * Reutiliza `useRecentShipments()` — mismo query key que `RecentShipmentsSection`, TanStack
 * Query deduplica la request, no pega dos veces a la API.
 */
export function ViewAllShipmentsLink({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const { data } = useRecentShipments();

  if (!data || data.items.length === 0) return null;

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push("/shipments")}
      className="mt-3 flex-row items-center justify-between rounded-[14px] border border-border bg-bg-sub px-4 py-3.5"
    >
      <Text className="font-sans-medium text-small text-fg">Ver todos mis envíos</Text>
      <ChevronRight size={16} strokeWidth={1.8} color={colors.fg3} />
    </Pressable>
  );
}
