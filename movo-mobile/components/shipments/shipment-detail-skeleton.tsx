import { View } from "react-native";
import { SkeletonBlock as Block } from "../ui/skeleton-block";

// Mismo alto que `RouteMapCard` (`components/send/route-map-card.tsx`) — el
// placeholder ocupa exactamente el lugar del mapa real, sin salto de layout cuando
// termina de cargar.
const MAP_HEIGHT = 220;

/** MOVO-168: solo el cuerpo (tabs + mapa + tarjetas), para las pantallas que ya renderizan su
 * propio header -- volver y el título no esperan al envío, solo lo que depende de él.
 * `tabs={false}` para el detalle del envío disponible, que no tiene pestañas. */
export function ShipmentDetailBodySkeleton({ testID, tabs = true }: { testID?: string; tabs?: boolean }) {
  return (
    <View testID={testID} className="flex-1">
      {tabs ? (
        <View className="flex-row px-5 pt-3">
          <Block className="mr-2 h-8 flex-1 rounded-md" />
          <Block className="h-8 flex-1 rounded-md" />
        </View>
      ) : null}

      <View className="gap-5 px-5 pb-6 pt-4">
        <Block className="rounded-[14px]" style={{ height: MAP_HEIGHT }} />
        <Block className="h-[76px] rounded-[14px]" />
        <View className="flex-row gap-2.5">
          <Block className="h-[72px] flex-1 rounded-[10px]" />
          <Block className="h-[72px] flex-1 rounded-[10px]" />
        </View>
        <Block className="h-[68px] rounded-[14px]" />
      </View>
    </View>
  );
}
