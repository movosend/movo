import { OfferStatus } from "@movo/shared/dist/types/offer";
import { router } from "expo-router";
import { ChevronLeft, HandCoins, WifiOff } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MyOfferCard, type MyOfferCardNotice } from "../../../../components/transport/my-offer-card";
import { SkeletonBlock } from "../../../../components/ui/skeleton-block";
import type { MyOfferSummary } from "../../../../src/api/offers-client";
import { useMyOffers } from "../../../../src/hooks/use-offers";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { competitiveRankNotice } from "../../../../src/lib/offer-format";
import { formatPriceArs } from "../../../../src/lib/shipment-format";

const CLOSED_STATUSES: readonly OfferStatus[] = [
  OfferStatus.REJECTED,
  OfferStatus.WITHDRAWN,
  OfferStatus.EXPIRED,
  OfferStatus.SUPERSEDED,
];

type OffersTab = "active" | "closed";

function byRecent(a: MyOfferSummary, b: MyOfferSummary): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/** Aviso de "requiere algo tuyo" de una oferta -- `null` para el resto (AC2/AC3 de
 * MOVO-151: solo lo que necesita una acción del transportista se destaca). */
function noticeFor(offer: MyOfferSummary): MyOfferCardNotice | null {
  if (offer.status === OfferStatus.ACCEPTED) {
    return { text: "Ya te aceptaron. Seguí el retiro desde el detalle del envío.", tone: "positive" };
  }
  if (offer.status === OfferStatus.PENDING && offer.competitiveRank) {
    const text = competitiveRankNotice(offer.competitiveRank);
    if (text) return { text, tone: "warning" };
  }
  return null;
}

function OffersSummarySkeleton() {
  return (
    <View className="gap-3 px-5 pt-2">
      <SkeletonBlock className="h-[92px] rounded-[14px]" />
      <SkeletonBlock className="h-[86px] rounded-[6px]" />
      <SkeletonBlock className="h-[86px] rounded-[6px]" />
    </View>
  );
}

function TabButton({
  label,
  active,
  testID,
  onPress,
}: {
  label: string;
  active: boolean;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className={`flex-1 items-center rounded-full py-2 ${active ? "bg-fg" : "bg-bg-mute"}`}
    >
      <Text className={`font-sans-semibold text-small ${active ? "text-bg" : "text-fg-2"}`}>{label}</Text>
    </Pressable>
  );
}

/**
 * "Mis ofertas" (MOVO-151, listado completo del bridge armado en MOVO-183): tabs
 * Activas/Cerradas (AC1/AC4, "activas" por defecto) sobre `GET /offers/mine`
 * (`useMyOffers`) ya enriquecido con distancia (MOVO-185), neto real (MOVO-186) y
 * ranking competitivo (MOVO-188).
 *
 * "Activas" separa "Requieren algo tuyo" (aceptadas + pendientes que no lideran el
 * ranking, `noticeFor`) del resto (pendientes liderando) -- una card sin aviso no
 * necesita destacarse. "Cerradas" agrupa rechazada/retirada/vencida/desplazada, todas
 * de solo lectura. Cada card navega al detalle real (`carrier/offers/[id]`, MOVO-182,
 * que ya tiene retirar/modificar -- AC6 se resuelve reusando esa pantalla, no
 * duplicando la acción acá) salvo una `accepted`, que va directo al envío ya asignado
 * (AC5).
 */
export default function MyOffersSummaryScreen() {
  const colors = useThemeColors();
  const { data, isLoading, isError, isRefetching, refetch } = useMyOffers({ limit: 50 });
  const [tab, setTab] = useState<OffersTab>("active");

  const items = data?.items ?? [];
  const pending = items.filter((o) => o.status === OfferStatus.PENDING);
  const accepted = items.filter((o) => o.status === OfferStatus.ACCEPTED);
  const closed = useMemo(
    () => items.filter((o) => CLOSED_STATUSES.includes(o.status)).sort(byRecent),
    [items],
  );
  const pendingTotal = pending.reduce((sum, o) => sum + o.priceNetArs, 0);
  const acceptedTotal = accepted.reduce((sum, o) => sum + o.priceNetArs, 0);

  const attention = useMemo(
    () =>
      [...accepted, ...pending.filter((o) => o.competitiveRank && o.competitiveRank.rank > 1)].sort(byRecent),
    [accepted, pending],
  );
  const attentionIds = useMemo(() => new Set(attention.map((o) => o.id)), [attention]);
  const rest = useMemo(
    () => pending.filter((o) => !attentionIds.has(o.id)).sort(byRecent),
    [pending, attentionIds],
  );

  function goToOffer(offer: MyOfferSummary) {
    if (offer.status === OfferStatus.ACCEPTED) {
      router.push(`/transport/${offer.shipmentId}`);
    } else {
      router.push(`/carrier/offers/${offer.id}`);
    }
  }

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
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <HandCoins size={24} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">Todavía no ofertaste en ningún envío.</Text>
          <Pressable
            testID="my-offers-empty-cta"
            onPress={() => router.replace("/(app)/(tabs)/transport")}
            className="mt-1 h-[44px] items-center justify-center rounded-lg bg-fg px-6"
          >
            <Text className="font-sans-semibold text-body text-bg">Ver envíos disponibles</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingBottom: 24, gap: 14 }}
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

          <View className="flex-row gap-2">
            <TabButton
              label="Activas"
              active={tab === "active"}
              testID="my-offers-tab-active"
              onPress={() => setTab("active")}
            />
            <TabButton
              label="Cerradas"
              active={tab === "closed"}
              testID="my-offers-tab-closed"
              onPress={() => setTab("closed")}
            />
          </View>

          {tab === "active" ? (
            pending.length === 0 && accepted.length === 0 ? (
              <Text className="py-6 text-center font-sans text-small text-fg-3">
                No tenés ofertas activas en este momento.
              </Text>
            ) : (
              <>
                {attention.length > 0 ? (
                  <View className="gap-2.5">
                    <View className="flex-row items-center gap-2 pt-1">
                      <View className="h-2 w-2 rounded-full bg-lime-500" />
                      <Text className="font-sans-semibold text-caption uppercase text-fg">Requieren algo tuyo</Text>
                    </View>
                    {attention.map((offer) => (
                      <MyOfferCard
                        key={offer.id}
                        testID={`my-offers-attention-${offer.id}`}
                        offer={offer}
                        notice={noticeFor(offer)}
                        onPress={() => goToOffer(offer)}
                      />
                    ))}
                  </View>
                ) : null}

                {rest.length > 0 ? (
                  <View className="gap-2.5">
                    <Text className="pt-1 font-sans-semibold text-caption uppercase text-fg-3">
                      El resto ({rest.length})
                    </Text>
                    {rest.map((offer) => (
                      <MyOfferCard
                        key={offer.id}
                        testID={`my-offers-active-${offer.id}`}
                        offer={offer}
                        onPress={() => goToOffer(offer)}
                      />
                    ))}
                  </View>
                ) : null}

                {pending.length > 0 ? (
                  <Text className="pb-2 text-center font-sans text-[11.5px] text-fg-3">
                    Las ofertas pendientes se cierran solas cuando pasa la fecha de retiro.
                  </Text>
                ) : null}
              </>
            )
          ) : closed.length === 0 ? (
            <Text className="py-6 text-center font-sans text-small text-fg-3">
              Todavía no tenés ofertas cerradas.
            </Text>
          ) : (
            <View className="gap-2.5">
              {closed.map((offer) => (
                <MyOfferCard
                  key={offer.id}
                  testID={`my-offers-closed-${offer.id}`}
                  offer={offer}
                  onPress={() => goToOffer(offer)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
