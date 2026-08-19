import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SkeletonBlock as Block } from "../ui/skeleton-block";

// Mismo alto que `RouteMapCard` (`components/send/route-map-card.tsx`) — el
// placeholder ocupa exactamente el lugar del mapa real, sin salto de layout cuando
// termina de cargar.
const MAP_HEIGHT = 220;

/** Estado de carga de la pantalla de detalle de envío (MOVO-127, feedback post-QA):
 * antes un `ActivityIndicator` genérico centrado, inconsistente con `ProfileSkeleton`
 * (misma idea acá — bloques con la forma real de cada sección, no un spinner). El
 * header replica el layout real (`app/(app)/shipments/[id].tsx`): volver + título +
 * badge de estado. */
export function ShipmentDetailSkeleton({ testID }: { testID?: string }) {
  return (
    <SafeAreaView testID={testID} className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Block className="h-8 w-8 rounded-full" />
        <View className="flex-1 gap-1.5">
          <Block className="h-4 w-36 rounded-md" />
          <Block className="h-2.5 w-16 rounded-md" />
        </View>
        <Block className="h-6 w-20 rounded-full" />
      </View>

      <View className="flex-row px-5 pt-3">
        <Block className="mr-2 h-8 flex-1 rounded-md" />
        <Block className="h-8 flex-1 rounded-md" />
      </View>

      <View className="gap-5 px-5 pb-6 pt-4">
        <Block className="rounded-[14px]" style={{ height: MAP_HEIGHT }} />
        <Block className="h-[76px] rounded-[14px]" />
        <View className="flex-row gap-2.5">
          <Block className="h-[72px] flex-1 rounded-[10px]" />
          <Block className="h-[72px] flex-1 rounded-[10px]" />
        </View>
        <Block className="h-[68px] rounded-[14px]" />
      </View>
    </SafeAreaView>
  );
}
