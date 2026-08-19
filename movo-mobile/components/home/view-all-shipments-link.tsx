import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, Text } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useRecentShipments } from "../../src/hooks/use-shipments";

/**
 * Acceso a "Mis Envíos" (MOVO-127), sección propia debajo de `RecentShipmentsSection`
 * — no un footer dentro de esa card. Feedback post-QA: una primera versión lo puso
 * como botón/card secundario y luego como link al pie de la card de actividad
 * reciente; ambas competían visualmente con `HomeSendCta` o quedaban "adentro" de un
 * bloque que no era su lugar. Acá es una fila de ancho completo, su propia sección
 * (sin fondo de acento ni sombra) — la única acción con peso visual de la pantalla
 * sigue siendo la CTA de enviar.
 *
 * Reusa `useRecentShipments()` — mismo query key que `RecentShipmentsSection`, TanStack
 * Query dedupe la request, no pega dos veces a la API. Solo se muestra si hay al menos
 * un envío (no tiene sentido "ver todos" sobre una lista vacía).
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
