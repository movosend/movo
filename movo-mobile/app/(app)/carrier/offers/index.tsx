import { OfferStatus } from "@movo/shared/dist/types/offer";
import { router } from "expo-router";
import { ChevronLeft, ChevronRight, HandCoins, WifiOff } from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SkeletonBlock } from "../../../../components/ui/skeleton-block";
import { useMyOffers } from "../../../../src/hooks/use-offers";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { formatPriceArs, shortAddressLabel } from "../../../../src/lib/shipment-format";
import { formatSentAgo, offerStatusLabel } from "../../../../src/lib/offer-format";
import type { MyOfferSummary } from "../../../../src/api/offers-client";

/**
 * Color del label de estado en la fila plana de "Todas tus ofertas" -- no reusa el
 * `tone` de `offerStatusBannerCopy` (pensado para el banner grande del detalle,
 * `neutral | positive | negative`, sin distinguir "pendiente" de "vencida/retirada").
 * Acá alcanza con un mapeo directo, más granular, a color de texto.
 */
const STATUS_TEXT_CLASS: Record<OfferStatus, string> = {
  [OfferStatus.PENDING]: "text-fg-2",
  [OfferStatus.ACCEPTED]: "text-lime-600",
  [OfferStatus.REJECTED]: "text-danger-500",
  [OfferStatus.WITHDRAWN]: "text-fg-3",
  [OfferStatus.EXPIRED]: "text-fg-3",
  [OfferStatus.SUPERSEDED]: "text-fg-3",
};

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
 *
 * "Todas tus ofertas" (agregado después, a pedido del usuario) lista TODAS las
 * ofertas propias sin importar estado -- pendientes, aceptadas, rechazadas, vencidas,
 * retiradas o superadas -- ordenadas por fecha de creación descendente. Cada fila
 * navega al detalle real de la oferta (`carrier/offers/[id]`, MOVO-182), que sí tiene
 * las acciones (cambiar precio, retirar). Esta pantalla sigue siendo solo un punto de
 * entrada sin ranking/reparto por oferta -- eso es MOVO-151.
 */
export default function MyOffersSummaryScreen() {
  const colors = useThemeColors();
  const { data, isLoading, isError, isRefetching, refetch } = useMyOffers({ limit: 50 });

  const items = data?.items ?? [];
  const pending = items.filter((o) => o.status === OfferStatus.PENDING);
  const accepted = items.filter((o) => o.status === OfferStatus.ACCEPTED);
  const pendingTotal = pending.reduce((sum, o) => sum + o.priceOffered, 0);
  const acceptedTotal = accepted.reduce((sum, o) => sum + o.priceOffered, 0);
  const allByRecent = [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

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
                <Text
                  testID="my-offers-pending-total"
                  className="font-sans-semibold text-[22px] tracking-[-0.03em] text-paper"
                >
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
                <Text
                  testID="my-offers-accepted-total"
                  className="font-sans-semibold text-[22px] tracking-[-0.03em] text-lime-500"
                >
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

          <View className="gap-2.5">
            <Text className="pt-2 font-sans-semibold text-caption uppercase text-fg-3">
              Todas tus ofertas ({allByRecent.length})
            </Text>
            <View className="overflow-hidden rounded-[14px] border border-border">
              {allByRecent.map((offer, index) => (
                <Pressable
                  key={offer.id}
                  testID={`my-offers-row-${offer.id}`}
                  onPress={() => router.push(`/carrier/offers/${offer.id}`)}
                  className={`flex-row items-center gap-3 bg-bg px-3.5 py-3 ${index > 0 ? "border-t border-border" : ""}`}
                >
                  <View className="flex-1">
                    <Text numberOfLines={1} className="font-sans-medium text-[14px] text-fg">
                      {route(offer)}
                    </Text>
                    <Text className={`mt-0.5 font-sans text-[11.5px] ${STATUS_TEXT_CLASS[offer.status]}`}>
                      {offerStatusLabel(offer.status)} · {formatSentAgo(offer.createdAt)}
                    </Text>
                  </View>
                  <Text className="font-sans-semibold text-[15px] text-fg">
                    {formatPriceArs(offer.priceOffered)}
                  </Text>
                  <ChevronRight size={16} color={colors.fg3} strokeWidth={2} />
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
