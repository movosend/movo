import { ActivityIndicator, Text, View } from "react-native";
import { PackageX, WifiOff } from "lucide-react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import type { TripWithAcceptedPackages } from "../../src/api/trips-client";
import { useRecentShipments } from "../../src/hooks/use-shipments";
import { useMyTrips } from "../../src/hooks/use-trips";
import { selectRecentShipments } from "../../src/lib/recent-shipments-selection";
import { presentMyShipment } from "../../src/lib/my-shipments-format";
import { shipmentLifecycleStage } from "../../src/lib/shipment-format";
import { splitCarrierHomeTrips } from "../../src/lib/trip-format";
import { useAuthStore } from "../../src/store/auth-store";
import { ShipmentRow } from "../shipments/shipment-row";
import { CarrierTripRow } from "./carrier-trip-row";
import { ViewAllShipmentsLink } from "./view-all-shipments-link";

/**
 * Sección "Actividad reciente" de Inicio (MOVO-83): vista previa de los últimos 3
 * envíos propios (`GET /shipments/mine`, MOVO-80 backend).
 *
 * Formato lista (fusión de MOVO-113 con un mockup de referencia): sin card/chrome
 * contenedor — un label de sección, una línea divisoria fina, y filas separadas por
 * bordes finos, terminando en "Ver todos mis envíos" como último ítem de la misma
 * lista (`ViewAllShipmentsLink`, ya no una sección aparte debajo).
 *
 * También lista los viajes `declared` con paquetes del transportista que no se llevan la
 * card de "Estoy transportando" (`splitCarrierHomeTrips`, la misma regla en las dos
 * secciones), mezclados con los envíos por su última actividad (`updatedAt` del viaje,
 * `lastStatusChangedAt`/`createdAt` del envío) sin alterar el orden que dejó
 * `selectRecentShipments` (acción → en curso → historial): los viajes se intercalan por
 * fecha pero nunca pasan por delante de un envío que requiere acción. La lista mezclada
 * respeta el mismo tope que los envíos.
 */
export function RecentShipmentsSection({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const { data, isLoading, isError, refetch } = useRecentShipments();
  const { data: myTripsData } = useMyTrips();
  const { otherTrips } = splitCarrierHomeTrips(myTripsData?.items ?? []);
  const currentUserId = useAuthStore((state) => state.user?.userId);

  const visibleShipments = data && currentUserId ? selectRecentShipments(data.items, currentUserId) : [];
  const actionCount = currentUserId
    ? visibleShipments.filter((s) => presentMyShipment(s, currentUserId).strip?.kind === "action").length
    : 0;

  const activeCount = visibleShipments.filter(
    (s) => shipmentLifecycleStage(s.status, { isReceiver: s.receiverId === currentUserId }) === "ongoing",
  ).length;

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
      ) : visibleShipments.length + otherTrips.length === 0 ? (
        <View className="items-center gap-2 py-6">
          <PackageX size={20} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-small text-fg-2">
            Todavía no hiciste ningún envío.
          </Text>
        </View>
      ) : (
        <View>
          {mergeByRecentActivity(visibleShipments, otherTrips, actionCount).map((item, index) =>
            item.kind === "trip" ? (
              <CarrierTripRow
                key={`trip-${item.trip.id}`}
                trip={item.trip}
                isFirst={index === 0}
                testID={`trip-row-${item.trip.id}`}
              />
            ) : (
              <ShipmentRow
                key={item.shipment.id}
                shipment={item.shipment}
                isFirst={index === 0}
                testID={`shipment-row-${item.shipment.id}`}
              />
            ),
          )}
        </View>
      )}

      <ViewAllShipmentsLink testID={testID ? `${testID}-view-all` : undefined} />
    </View>
  );
}

const RECENT_ACTIVITY_LIMIT = 3;

type ActivityItem =
  | { kind: "shipment"; shipment: ShipmentSummary; at: string }
  | { kind: "trip"; trip: TripWithAcceptedPackages; at: string };

/** Conserva el orden de `shipments` (ya priorizado) y va intercalando los viajes por
 * recencia: un viaje se ubica antes del primer envío más viejo que él, pero nunca dentro
 * de los primeros `actionCount` (los que requieren acción). Corta en `limit`. */
function mergeByRecentActivity(
  shipments: ShipmentSummary[],
  trips: TripWithAcceptedPackages[],
  actionCount: number,
  limit = RECENT_ACTIVITY_LIMIT,
): ActivityItem[] {
  const items: ActivityItem[] = shipments.map((shipment) => ({
    kind: "shipment",
    shipment,
    at: shipment.lastStatusChangedAt ?? shipment.createdAt,
  }));
  const sortedTrips = trips
    .map((trip): ActivityItem => ({ kind: "trip", trip, at: trip.updatedAt }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const tripItem of sortedTrips) {
    let index = items.findIndex((item, i) => i >= actionCount && Date.parse(item.at) < Date.parse(tripItem.at));
    if (index === -1) index = items.length;
    items.splice(index, 0, tripItem);
  }
  return items.slice(0, limit);
}
