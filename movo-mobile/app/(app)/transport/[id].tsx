import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Clock, Route } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CounterpartCard } from "../../../components/shipments/counterpart-card";
import { PackageCard } from "../../../components/shipments/package-card";
import { ShipmentDetailSkeleton } from "../../../components/shipments/shipment-detail-skeleton";
import { ShipmentStatusBadge } from "../../../components/shipments/status-badge";
import { RouteMapCard } from "../../../components/send/route-map-card";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { GridPattern } from "../../../components/ui/grid-pattern";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useShipment, useShipmentRoute } from "../../../src/hooks/use-shipments";
import {
  formatPickupDateLabel,
  formatRouteDistanceKm,
  formatShipmentPrice,
  formatTimeHHMM,
  formatTripDistanceKm,
  haversineDistanceKm,
  receiverConfirmationStatus,
} from "../../../src/lib/shipment-format";

function Eyebrow({ children }: { children: ReactNode }) {
  return <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">{children}</Text>;
}

function TransportDetailError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // A diferencia de `shipments/[id].tsx` (vista del emisor/receptor, donde un 403
  // significa "no te pertenece"), acá el caller nunca es dueño del envío — un 403 en
  // este contexto significa que dejó de estar `published` entre que se listó y se
  // tocó la card (otro transportista ya se lo llevó, o el emisor lo canceló).
  const message =
    error instanceof ApiError && error.statusCode === 403
      ? "Este envío ya no está disponible."
      : error instanceof ApiError && error.statusCode === 404
        ? "Este envío no existe."
        : "No pudimos cargar este envío.";

  return (
    <View className="px-5 pt-2">
      <ErrorBanner testID="transport-detail-error" message={message} />
      <Text onPress={onRetry} className="mt-3 font-sans-medium text-small text-fg">
        Reintentar
      </Text>
    </View>
  );
}

/**
 * Detalle de un envío disponible, del lado del transportista (MOVO-148, AC9) —
 * pantalla propia, separada de `shipments/[id].tsx` (esa es la vista del
 * emisor/receptor sobre sus propios envíos). Antes de esta pantalla, el tab
 * "Transportar" reusaba esa misma ruta: mostraba solo "Receptor" (el código asumía
 * que quien no es receptor tiene que ser el emisor, sin contemplar un tercer rol) y
 * el banner de "Ofertas" con copy pensado para el emisor ("Aún no tenés ofertas").
 * Acá se muestran ambas contrapartes (Emisor y Receptor) siempre en ese orden fijo —
 * a esta pantalla solo se llega desde el listado de envíos disponibles, nunca siendo
 * parte del envío, así que no hace falta ningún cálculo de rol para decidir el orden.
 *
 * Sin tabs de línea de tiempo ni acciones (aceptar/rechazar/cancelar/ofertar) — lo
 * único que hoy puede hacer acá un transportista es mirar; "hacer una oferta" es
 * MOVO-149, todavía sin el endpoint de creación en el backend.
 */
export default function TransportShipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { data: shipment, isLoading, isError, error, refetch } = useShipment(id);

  const pickupDateLabel = shipment ? formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate : null;
  const tripDistanceKm = shipment
    ? haversineDistanceKm(shipment.pickupLat, shipment.pickupLng, shipment.deliveryLat, shipment.deliveryLng)
    : null;
  // `RouteMapCard` de abajo ya pide esta misma ruta (mismos pickup/delivery) para
  // dibujar el mapa — TanStack Query dedupea por query key, así que pedirla acá de
  // nuevo no dispara un segundo request a la Google Routes API, solo comparte la
  // cache. Con la ruta real disponible, mostramos su `distanceMeters` en vez de la
  // aproximación en línea recta; mientras carga o si falla, cae a `tripDistanceKm`.
  const { data: route } = useShipmentRoute(
    shipment ? { lat: shipment.pickupLat, lng: shipment.pickupLng } : null,
    shipment ? { lat: shipment.deliveryLat, lng: shipment.deliveryLng } : null,
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)/transport");
    }
  };

  if (isLoading) {
    return <ShipmentDetailSkeleton testID="transport-detail-skeleton" />;
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="transport-detail-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sans-semibold text-h3 text-fg">Detalle del envío</Text>
          {shipment ? (
            <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-wide text-fg-3">
              {shipment.id.slice(0, 8)}
            </Text>
          ) : null}
        </View>
        {shipment ? <ShipmentStatusBadge status={shipment.status} /> : null}
      </View>

      {isError || !shipment ? (
        <TransportDetailError error={error} onRetry={() => refetch()} />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-6 pt-4">
          <View>
            <Eyebrow>Ruta</Eyebrow>
            <RouteMapCard
              testID="transport-detail-route-map"
              pickup={{ address: shipment.pickupAddress, lat: shipment.pickupLat, lng: shipment.pickupLng }}
              delivery={{ address: shipment.deliveryAddress, lat: shipment.deliveryLat, lng: shipment.deliveryLng }}
            />
            <View className="mt-2 flex-row items-center gap-1.5">
              <Route size={13} strokeWidth={1.8} color={colors.fg3} />
              <Text testID="transport-detail-trip-distance" className="font-sans text-caption text-fg-3">
                {route
                  ? `${formatRouteDistanceKm(route.distanceMeters)} de viaje`
                  : `${formatTripDistanceKm(tripDistanceKm!)} de viaje (aprox.)`}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-3">
            <View className="relative flex-1 overflow-hidden rounded-[10px] bg-bg-mute px-3.5 py-3.5">
              <GridPattern />
              <View className="mb-2 flex-row items-center gap-1.5">
                <Clock size={14} color={colors.fg2} />
                <Text className="font-sans text-[11px] text-fg-3">Retiro</Text>
              </View>
              <Text className="font-sans-semibold text-[13px] text-fg">{pickupDateLabel}</Text>
              <Text className="mt-0.5 font-sans text-[12px] text-fg-2">
                {formatTimeHHMM(shipment.pickupTimeWindowStart)} – {formatTimeHHMM(shipment.pickupTimeWindowEnd)}
              </Text>
            </View>
            <View className="relative flex-1 overflow-hidden rounded-[10px] bg-lime-200 px-3.5 py-3.5">
              <GridPattern />
              <Text className="mb-1 font-sans text-[11px] text-ink-950/50">Costo aproximado</Text>
              <Text className="font-sans-semibold text-[20px] text-ink-950">
                {formatShipmentPrice(shipment.agreedPriceArs, shipment.suggestedPriceArs)}
              </Text>
            </View>
          </View>

          <View>
            <Eyebrow>Paquete</Eyebrow>
            <PackageCard shipment={shipment} testID="transport-detail-package" />
          </View>

          <View>
            <Eyebrow>Emisor</Eyebrow>
            <CounterpartCard userId={shipment.senderId} testID="transport-detail-sender" />
          </View>

          <View>
            <Eyebrow>Receptor</Eyebrow>
            <CounterpartCard
              userId={shipment.receiverId}
              receiverConfirmation={receiverConfirmationStatus(shipment.status)}
              testID="transport-detail-receiver"
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
