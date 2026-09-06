import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Clock, Route } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CounterpartCard } from "../../../components/shipments/counterpart-card";
import { PackageCard } from "../../../components/shipments/package-card";
import { ShipmentDetailSkeleton } from "../../../components/shipments/shipment-detail-skeleton";
import { ShipmentStatusBadge } from "../../../components/shipments/status-badge";
import { RouteMapCard } from "../../../components/send/route-map-card";
import { CreateOfferSheet } from "../../../components/transport/create-offer-sheet";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { GridPattern } from "../../../components/ui/grid-pattern";
import { SuccessBanner } from "../../../components/ui/success-banner";
import { useMyOffers, useWithdrawOffer } from "../../../src/hooks/use-offers";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useShipment, useShipmentRoute } from "../../../src/hooks/use-shipments";
import {
  formatPickupDateLabel,
  formatPriceArs,
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
 * Detalle de un envío disponible para el transportista (MOVO-166) con la acción de
 * ofertar y retirar oferta (MOVO-149, frontend de MOVO-23).
 *
 * Muestra ruta en mapa, paquete, fotos, ventana horaria, precio sugerido, Emisor y
 * Receptor sin datos de contacto.
 *
 * Si el transportista aún no ofertó:
 * - Acción principal "Hacer una oferta" que abre `CreateOfferSheet`.
 *
 * Si el transportista ya tiene una oferta activa:
 * - Muestra la card con los datos de su oferta.
 * - La acción principal cambia a "Retirar oferta" con confirmación.
 */
export default function TransportShipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { data: shipment, isLoading, isError, error, refetch } = useShipment(id);
  // `limit: 50` es el máximo que acepta el backend (`offers.schema.ts`, default 20) —
  // sin un filtro por `shipmentId` del lado del servidor, esto es lo más que se puede
  // acotar el riesgo de no encontrar una oferta pendiente existente si el transportista
  // tiene más ofertas activas que el límite de una sola página.
  const { data: myOffers } = useMyOffers({ status: OfferStatus.PENDING, limit: 50 });
  const withdrawOffer = useWithdrawOffer(id);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  const myActiveOffer = myOffers?.items.find((offer) => offer.shipmentId === id);

  const openProfile = (userId: string) => router.push(`/profile/${userId}`);

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

  const handleWithdraw = () => {
    if (!myActiveOffer) return;
    Alert.alert(
      "¿Retirar oferta?",
      "¿Estás seguro de que querés retirar tu oferta? Vas a poder volver a ofertar si el envío sigue disponible.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Retirar",
          style: "destructive",
          onPress: () => {
            withdrawOffer.mutate(myActiveOffer.id, {
              onSuccess: () => {
                setWithdrawSuccess(true);
              },
            });
          },
        },
      ]
    );
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
        <View className="flex-1">
          <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-6 pt-4">
            {withdrawSuccess ? (
              <SuccessBanner
                testID="transport-withdraw-success"
                message="Tu oferta fue retirada."
                onDismiss={() => setWithdrawSuccess(false)}
              />
            ) : null}

            {myActiveOffer ? (
              <View
                testID="transport-active-offer-card"
                className="rounded-[12px] border border-info-200 bg-info-100/50 p-4"
              >
                <View className="mb-2 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1.5">
                    <Clock size={14} color="#1F52D6" />
                    <Text className="font-sans-semibold text-small text-info-700">Tu oferta activa</Text>
                  </View>
                  <View className="rounded-md bg-info-200 px-2 py-0.5">
                    <Text className="font-sans-medium text-[11px] text-info-700">Pendiente</Text>
                  </View>
                </View>
                <View className="mt-1 gap-1.5">
                  <View className="flex-row items-baseline justify-between">
                    <Text className="font-sans text-small text-fg-2">Monto total (emisor)</Text>
                    <Text testID="transport-active-offer-price" className="font-sans-semibold text-body text-fg">
                      {formatPriceArs(myActiveOffer.priceOffered)}
                    </Text>
                  </View>
                  <View className="flex-row items-baseline justify-between">
                    <Text className="font-sans text-small text-fg-2">Fecha del viaje</Text>
                    <Text testID="transport-active-offer-date" className="font-sans-medium text-small text-fg">
                      {formatPickupDateLabel(myActiveOffer.offeredDate) ?? myActiveOffer.offeredDate}
                    </Text>
                  </View>
                  {myActiveOffer.message ? (
                    <View className="mt-1 border-t border-info-200/60 pt-2">
                      <Text className="font-sans text-[11px] text-fg-3">Mensaje enviado:</Text>
                      <Text testID="transport-active-offer-message" className="mt-0.5 font-sans text-small text-fg">
                        {myActiveOffer.message}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

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
              <CounterpartCard
                userId={shipment.senderId}
                onPress={() => openProfile(shipment.senderId)}
                testID="transport-detail-sender"
              />
            </View>

            <View>
              <Eyebrow>Receptor</Eyebrow>
              <CounterpartCard
                userId={shipment.receiverId}
                receiverConfirmation={receiverConfirmationStatus(shipment.status)}
                onPress={() => openProfile(shipment.receiverId)}
                testID="transport-detail-receiver"
              />
            </View>
          </ScrollView>

          <View className="border-t border-border bg-bg px-5 pb-6 pt-3.5">
            {myActiveOffer ? (
              <Pressable
                testID="transport-withdraw-offer-cta"
                onPress={handleWithdraw}
                disabled={withdrawOffer.isPending}
                className="w-full flex-row items-center justify-center gap-2 rounded-lg border border-danger-300 bg-danger-100 py-3.5"
              >
                {withdrawOffer.isPending ? <ActivityIndicator color="#C22F35" /> : null}
                <Text className="font-sans-semibold text-body text-danger-700">Retirar oferta</Text>
              </Pressable>
            ) : (
              <Pressable
                testID="transport-create-offer-cta"
                onPress={() => setSheetOpen(true)}
                className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3.5"
              >
                <Text className="font-sans-semibold text-body text-bg">Hacer una oferta</Text>
              </Pressable>
            )}
          </View>

          <CreateOfferSheet
            testID="transport-create-offer-sheet"
            visible={sheetOpen}
            shipment={shipment}
            onClose={() => setSheetOpen(false)}
            onSuccess={() => {
              setSheetOpen(false);
              router.replace({
                pathname: "/(app)/(tabs)/transport",
                params: { offerCreated: "1" },
              });
            }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

