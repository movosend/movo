import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, Text } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useRecentShipments } from "../../src/hooks/use-shipments";

/**
 * Acceso a "Mis Envíos" — último ítem de la lista de `RecentShipmentsSection` (fusión
 * con mockup de referencia, MOVO-113): botón píldora de ancho completo, separado del
 * resto de las filas por su propio margen (no un `border-t` — es un botón, no una
 * fila más de la lista). Solo se muestra si hay al menos un envío (no tiene sentido
 * "ver todos" sobre una lista vacía).
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
      className="mt-3 flex-row items-center justify-center gap-1 rounded-full border border-border py-3.5"
    >
      <Text className="font-sans-medium text-small text-fg">Ver todos mis envíos</Text>
      <ChevronRight size={16} strokeWidth={1.8} color={colors.fg3} />
    </Pressable>
  );
}
