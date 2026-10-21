import { Pressable, Text, View } from "react-native";
import { WifiOff } from "lucide-react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { SkeletonBlock } from "../ui/skeleton-block";

/**
 * MOVO-168: estados de carga y falla de Inicio. Cada sección muestra su skeleton mientras
 * carga (antes devolvía `null`, indistinguible de "no tenés nada"), así que cada bloque
 * aparece apenas llegan sus datos. Una sección que falla sin datos no se muestra, porque no
 * sabemos si te corresponde: la falla es un solo aviso para todo Inicio (`home.tsx`).
 */

/** Alto de `ActiveShipmentCard` (padding 20 + encabezado + stepper + retiro/entrega + CTA). */
export const ACTIVE_CARD_SKELETON_HEIGHT = 260;
/** Alto de `CarrierTripCta` (card del viaje en curso/de hoy). */
export const TRIP_CARD_SKELETON_HEIGHT = 168;
/** Alto de una card de "Requiere tu atención". */
export const ATTENTION_CARD_SKELETON_HEIGHT = 92;

/**
 * Silueta de una sección con encabezado (label en mayúsculas, `text-caption`) y una o más
 * cards. Mismos `mb-6` y `gap-2.5` que `RoleSection`/`AttentionTaskList` para que no haya
 * salto al pasar al contenido real.
 */
export function HomeSectionSkeleton({
  testID,
  cardHeight,
  cards = 1,
}: {
  testID?: string;
  cardHeight: number;
  cards?: number;
}) {
  return (
    <View testID={testID} className="mb-6 gap-2.5">
      {/* Línea de texto `text-caption` (16 de alto) */}
      <SkeletonBlock className="h-4 w-28 rounded" />
      {Array.from({ length: cards }, (_, index) => (
        <SkeletonBlock
          key={index}
          style={{ height: cardHeight }}
          className="w-full rounded-[10px] border border-border"
        />
      ))}
    </View>
  );
}

/**
 * Aviso de falla con "Reintentar". En Inicio es uno solo para todas las secciones que
 * fallaron sin datos (`home.tsx`). Mismo patrón visual que el error de "Actividad reciente".
 */
export function HomeSectionError({
  title,
  message,
  onRetry,
  testID,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View testID={testID} className="mb-6 gap-2.5">
      {title ? <Text className="font-sans-medium text-caption uppercase text-fg-3">{title}</Text> : null}
      <View className="items-center gap-2 rounded-[10px] border border-border py-5">
        <WifiOff size={20} strokeWidth={1.8} color={colors.fg3} />
        <Text className="text-center font-sans text-small text-fg-2">{message}</Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          hitSlop={8}
          testID={testID ? `${testID}-retry` : undefined}
          className="min-h-[44px] items-center justify-center px-4"
        >
          <Text className="font-sans-medium text-small text-fg">Reintentar</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Filas de "Actividad reciente" (`ShipmentRow`: ícono de 44 + `py-3`, separadas por borde
 * fino), una por cada preview que entra en la lista.
 */
export function RecentRowsSkeleton({ testID, rows = 3 }: { testID?: string; rows?: number }) {
  return (
    <View testID={testID}>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          className={`flex-row items-center gap-3 py-3 ${index === 0 ? "" : "border-t border-border"}`}
        >
          <SkeletonBlock className="h-11 w-11 rounded-full" />
          <View className="flex-1 gap-1.5">
            <SkeletonBlock className="h-4 w-3/5 rounded" />
            <SkeletonBlock className="h-3.5 w-2/5 rounded" />
          </View>
          <SkeletonBlock className="h-4 w-12 rounded" />
        </View>
      ))}
    </View>
  );
}
