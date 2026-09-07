import { OfferStatus } from "@movo/shared/dist/types/offer";
import { router } from "expo-router";
import { ChevronLeft, HandCoins, WifiOff } from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SkeletonBlock } from "../../../../components/ui/skeleton-block";
import { useMyOffers } from "../../../../src/hooks/use-offers";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { formatPriceArs, shortAddressLabel } from "../../../../src/lib/shipment-format";
import type { MyOfferSummary } from "../../../../src/api/offers-client";

function OffersSummarySkeleton() {
  return (
    <View className="gap-3 px-5 pt-2">
      <SkeletonBlock className="h-[92px] rounded-[14px]" />
      <SkeletonBlock className="h-[86px] rounded-[6px]" />
      <SkeletonBlock className="h-[86px] rounded-[6px]" />
    </View>
  );
}

function route(offer: MyOfferSummary): string {
  return `${shortAddressLabel(offer.shipment.pickupAddress)} → ${shortAddressLabel(offer.shipment.deliveryAddress)}`;
}

/**
 * "Mis ofertas" (MOVO-183, prototipo de Claude Design): esta pantalla ES la
 * pantalla completa — todavía sin ranking de posición ni reparto por oferta
 * (`GET /shipments/:id/offers`, restringido al emisor hoy, no expone esos datos al
 * transportista), eso es alcance de otra US (MOVO-151), no un link a otro lado. Usa
 * datos 100% reales de `GET /offers/mine` (`useMyOffers`, ya existente desde
 * MOVO-149) — "requieren algo tuyo" se limita a ofertas ya `accepted` (el envío
 * avanza y el transportista tiene que seguir su estado/retiro desde el detalle), no
 * a la simulación de "estás 4to de 5" del mock, que no es un dato real disponible acá.
 */
export default function MyOffersSummaryScreen() {
  const colors = useThemeColors();
  const { data, isLoading, isError, isRefetching, refetch } = useMyOffers({ limit: 50 });

  const items = data?.items ?? [];
  const pending = items.filter((o) => o.status === OfferStatus.PENDING);
  const accepted = items.filter((o) => o.status === OfferStatus.ACCEPTED);
  const pendingTotal = pending.reduce((sum, o) => sum + o.priceOffered, 0);
  const acceptedTotal = accepted.reduce((sum, o) => sum + o.priceOffered, 0);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="my-offers-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)/(tabs)/transport"))}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View>
          <Text className="font-sans-semibold text-h3 text-fg">Mis ofertas</Text>
          <Text className="font-sans text-[11.5px] text-fg-3">
            {pending.length} pendientes · {accepted.length} {accepted.length === 1 ? "aceptada" : "aceptadas"}
          </Text>
        </View>
      </View>

      {isLoading ? (
        <OffersSummarySkeleton />
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">No pudimos cargar tus ofertas.</Text>
          <Text testID="my-offers-retry" onPress={() => refetch()} className="font-sans-medium text-small text-fg">
            Reintentar
          </Text>
        </View>
      ) : items.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <HandCoins size={24} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">Todavía no ofertaste en ningún envío.</Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingBottom: 24, gap: 12 }}
          refreshControl={<RefreshControl testID="my-offers-refresh" refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          <View className="overflow-hidden rounded-[14px] bg-ink-950">
            <View className="flex-row">
              <View className="flex-1 gap-1 p-4">
                <Text className="font-sans-semibold text-caption uppercase text-ink-300">En juego</Text>
                <Text className="font-sans-semibold text-[22px] tracking-[-0.03em] text-paper">
                  {formatPriceArs(pendingTotal)}
                </Text>
                <Text className="font-sans text-[11px] text-ink-300">
                  {pending.length} sin respuesta
                </Text>
              </View>
              <View className="w-px bg-white/10" />
              <View className="flex-1 gap-1 p-4">
                <View className="self-start rounded-full bg-lime-500 px-2 py-0.5">
                  <Text className="font-sans-semibold text-[10px] uppercase text-ink-950">Confirmado</Text>
                </View>
                <Text className="font-sans-semibold text-[22px] tracking-[-0.03em] text-lime-500">
                  {formatPriceArs(acceptedTotal)}
                </Text>
                <Text className="font-sans text-[11px] text-ink-300">cobrás al entregar</Text>
              </View>
            </View>
          </View>

          {accepted.length > 0 ? (
            <View className="gap-2.5">
              <View className="flex-row items-center gap-2 pt-2">
                <View className="h-2 w-2 rounded-full bg-lime-500" />
                <Text className="font-sans-semibold text-caption uppercase text-fg">Requieren algo tuyo</Text>
              </View>
              {accepted.map((offer) => (
                <Pressable
                  key={offer.id}
                  testID={`my-offers-accepted-${offer.id}`}
                  onPress={() => router.push(`/transport/${offer.shipmentId}`)}
                  className="gap-2.5 rounded-md border-[1.5px] border-fg bg-bg p-3.5"
                >
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="font-sans-semibold text-caption uppercase text-fg">Aceptada</Text>
                      <Text numberOfLines={1} className="mt-1 font-sans-semibold text-[15px] text-fg">
                        {route(offer)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="font-sans-semibold text-[19px] text-fg">{formatPriceArs(offer.priceOffered)}</Text>
                      <Text className="font-sans text-[11px] text-fg-3">te queda</Text>
                    </View>
                  </View>
                  <View className="rounded-md bg-lime-200/60 px-2.5 py-2">
                    <Text className="font-sans-medium text-[12px] leading-[16px] text-[#4A5A20]">
                      Ya te aceptaron. Seguí el retiro desde el detalle del envío.
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
