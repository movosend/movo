import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, History, MapPinOff, Plus, WifiOff } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View, Pressable } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SuspendedActionNotice } from "../../../../components/account/suspended-action-notice";
import { PressableScale } from "../../../../components/trips/pressable-scale";
import { TripCard } from "../../../../components/trips/trip-card";
import { TripHistoryCard } from "../../../../components/trips/trip-history-card";
import { TripsSegmented } from "../../../../components/trips/trips-segmented";
import { SkeletonBlock } from "../../../../components/ui/skeleton-block";
import { SuccessBanner } from "../../../../components/ui/success-banner";
import { useActiveSuspension } from "../../../../src/hooks/use-account-restriction";
import { useMyTripsPaged } from "../../../../src/hooks/use-trips";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { groupTripsByMonth, tripCancelledMessage } from "../../../../src/lib/trip-format";
import { newTripsBannerMessage } from "../../../../src/lib/trip-recurrence";
import { diffAndMarkSeenTrips } from "../../../../src/lib/seen-trips";
import { type TripListScope, type TripWithAcceptedPackages } from "../../../../src/api/trips-client";

function TripsListSkeleton() {
  return (
    <View className="gap-3 px-5 pt-4">
      {[0, 1, 2].map((i) => (
        <SkeletonBlock key={i} className="h-[150px] rounded-[10px]" />
      ))}
    </View>
  );
}

/**
 * "Mis viajes" (MOVO-162, rediseño MOVO-262 según el mockup de Claude Design): header con
 * back, segmented Próximos/Historial (cada tab consume `GET /trips?scope=…`), cards "Horario"
 * para los viajes vigentes, historial agrupado por mes y barra inferior "Declarar viaje".
 * Sin scroll infinito (el volumen esperado no lo justifica, ver CLAUDE.md). Hereda el guard
 * de sesión de `app/(app)/_layout.tsx`.
 */
export default function MyTripsScreen() {
  const colors = useThemeColors();
  const { created, createdAt, cancelledTo, cancelledAt, cancelledPackages, cancelledDebt } = useLocalSearchParams<{
    created?: string;
    createdAt?: string;
    cancelledTo?: string;
    cancelledAt?: string;
    cancelledPackages?: string;
    cancelledDebt?: string;
  }>();
  // MOVO-262 AC1: una query (y una query key) por tab; el default es "Próximos".
  const [scope, setScope] = useState<TripListScope>("upcoming");
  const suspension = useActiveSuspension();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, isRefetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useMyTripsPaged(scope);
  const trips = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const [showCreatedSuccess, setShowCreatedSuccess] = useState(created === "1");
  useEffect(() => {
    if (created === "1") setShowCreatedSuccess(true);
    // MOVO-340: "Declarar viaje" vuelve con `dismissTo` a esta misma instancia; `createdAt`
    // cambia en cada alta aunque `created` ya valiera "1".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, createdAt]);
  // MOVO-263: el detalle de un viaje vuelve acá con el destino cancelado para avisarlo.
  // MOVO-314: si el viaje tenía paquetes, el aviso suma qué pasó con ellos y con la deuda.
  const cancelledText = cancelledTo
    ? tripCancelledMessage(cancelledTo, Number(cancelledPackages ?? 0), Number(cancelledDebt ?? 0))
    : null;
  const [cancelledMessage, setCancelledMessage] = useState<string | null>(cancelledText);
  useEffect(() => {
    if (cancelledText) setCancelledMessage(cancelledText);
    // `cancelledAt` cambia en cada cancelación aunque el destino sea el mismo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelledTo, cancelledAt]);
  const [autoCreatedMessage, setAutoCreatedMessage] = useState<string | null>(null);

  /**
   * MOVO-236, AC2: fallback in-app del aviso de viaje auto-creado (MOVO-234) cuando no
   * hay push. Diffea contra el set de `tripId`s ya vistos por este dispositivo
   * (`src/lib/seen-trips.ts`) — corre en cada carga de `data` (incluido un
   * pull-to-refresh, idempotente, no hay costo real en repetirlo). Si venimos recién
   * de "Declarar viaje" (`?created=1`), ese banner ya tiene prioridad -- el diff igual
   * corre para dejar el set de vistos al día, pero no pisa el mensaje.
   */
  useEffect(() => {
    if (!data || scope !== "upcoming") return;
    let cancelled = false;
    diffAndMarkSeenTrips(trips.map((trip) => trip.id)).then(({ newTripIds }) => {
      if (cancelled || newTripIds.length === 0 || created === "1") return;
      const newIds = new Set(newTripIds);
      setAutoCreatedMessage(newTripsBannerMessage(trips.filter((trip) => newIds.has(trip.id))));
    });
    return () => {
      cancelled = true;
    };
  }, [data, created, scope]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)/transport");
    }
  };

  const hasTrips = trips.length > 0;
  const isHistory = scope === "history";
  // Con "Próximos" vacío ya hay un "Declarar viaje" en el estado vacío: la barra de abajo se
  // oculta para no mostrar dos botones iguales (review de PR #219).
  const showAddBar = isLoading || isError || hasTrips || isHistory;
  // Alto de la barra = 12 (padding superior) + 52 (botón) + inset inferior real del dispositivo.
  const barBottomPadding = Math.max(insets.bottom, 12);
  const scrollBottomPadding = showAddBar ? 12 + 52 + barBottomPadding + 24 : insets.bottom + 24;

  // MOVO-262 AC5: tocar la card abre el detalle (MOVO-263). `as any`: ruta nueva, todavía no
  // figura en los tipos de rutas de expo-router.
  const openDetail = (trip: TripWithAcceptedPackages) => router.push(`/carrier/trips/${trip.id}` as any);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: scrollBottomPadding, flexGrow: 1 }}
        refreshControl={
          <RefreshControl testID="my-trips-refresh" refreshing={isRefetching} onRefresh={() => refetch()} />
        }
      >
        <View className="flex-row items-center gap-3 pt-1">
          <Pressable
            testID="my-trips-back"
            onPress={handleBack}
            className="h-10 w-10 items-center justify-center rounded-full bg-bg-mute"
          >
            <ChevronLeft size={20} color={colors.fg1} strokeWidth={1.75} />
          </Pressable>
          <Text className="font-sans-semibold text-[22px] tracking-[-0.44px] text-fg">Mis viajes</Text>
        </View>
        <Text className="mt-2.5 font-sans text-[14px] leading-[20px] text-fg-3">
          Declarás el camino que ya vas a hacer y te aparecen paquetes que van para el mismo lado.
        </Text>

        <SuccessBanner
          testID="my-trips-cancelled-success"
          message={cancelledMessage}
          onDismiss={() => setCancelledMessage(null)}
        />
        <SuccessBanner
          testID={showCreatedSuccess ? "my-trips-created-success" : "my-trips-auto-created-success"}
          message={showCreatedSuccess ? "¡Viaje declarado!" : autoCreatedMessage}
          onDismiss={() => (showCreatedSuccess ? setShowCreatedSuccess(false) : setAutoCreatedMessage(null))}
        />

        <TripsSegmented value={scope} onChange={setScope} />

        {isLoading ? (
          <TripsListSkeleton />
        ) : isError ? (
          <View className="items-center justify-center gap-2 px-8 pt-24">
            <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
            <Text className="text-center font-sans text-body text-fg-2">No pudimos cargar tus viajes.</Text>
            <Text testID="my-trips-retry" onPress={() => refetch()} className="font-sans-medium text-small text-fg">
              Reintentar
            </Text>
          </View>
        ) : !hasTrips ? (
          isHistory ? (
            <View className="items-center gap-2.5 px-6 pt-24">
              <View className="mb-2 h-[72px] w-[72px] items-center justify-center rounded-full bg-bg-mute">
                <History size={30} color={colors.fg3} strokeWidth={1.75} />
              </View>
              <Text className="text-center font-sans-semibold text-[18px] tracking-[-0.18px] text-fg">
                Todavía no tenés viajes terminados
              </Text>
              <Text className="max-w-[260px] text-center font-sans text-[14px] leading-[20px] text-fg-3">
                Cuando completes o canceles un viaje, lo vas a encontrar acá.
              </Text>
            </View>
          ) : (
            <View className="items-center gap-3 px-8 pt-24">
              <MapPinOff size={26} strokeWidth={1.8} color={colors.fg3} />
              <Text className="text-center font-sans text-body text-fg-2">Todavía no declaraste ningún viaje.</Text>
              {suspension ? (
                <SuspendedActionNotice
                  testID="my-trips-empty-add-suspended"
                  action="declareTrip"
                  suspension={suspension}
                />
              ) : (
                <Pressable
                  testID="my-trips-empty-add"
                  // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
                  onPress={() => router.push("/carrier/trips/new" as any)}
                  className="rounded-full bg-fg px-4 py-2.5"
                >
                  <Text className="font-sans-medium text-[13px] text-bg">Declarar viaje</Text>
                </Pressable>
              )}
            </View>
          )
        ) : isHistory ? (
          <View className="mt-2">
            {groupTripsByMonth(trips).map((group) => (
              <View key={group.label}>
                <Text className="px-0.5 pb-2.5 pt-5 font-sans-semibold text-[11px] uppercase tracking-[0.88px] text-fg-3">
                  {group.label}
                </Text>
                <View className="gap-2">
                  {group.trips.map((trip) => (
                    <TripHistoryCard
                      key={trip.id}
                      testID={`my-trips-card-${trip.id}`}
                      trip={trip}
                      onPress={() => openDetail(trip)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className="mt-4 gap-3">
            {trips.map((trip) => (
              <TripCard
                key={trip.id}
                testID={`my-trips-card-${trip.id}`}
                trip={trip}
                onPress={() => openDetail(trip)}
              />
            ))}
          </View>
        )}

        {hasNextPage ? (
          <Pressable
            testID="my-trips-load-more"
            onPress={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="mt-4 h-11 items-center justify-center rounded-lg border border-border-strong"
          >
            <Text className="font-sans-medium text-[14px] text-fg">
              {isFetchingNextPage ? "Cargando…" : "Cargar más"}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {showAddBar ? (
      <View
        className="absolute inset-x-0 bottom-0 border-t border-border bg-bg px-5 pt-3"
        style={{ paddingBottom: barBottomPadding }}
      >
        {suspension ? (
          // MOVO-300 AC2: el gateway rechaza declarar un viaje con la cuenta suspendida.
          <SuspendedActionNotice testID="my-trips-add-suspended" action="declareTrip" suspension={suspension} />
        ) : (
        <PressableScale
          testID="my-trips-add"
          // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
          onPress={() => router.push("/carrier/trips/new" as any)}
          className="h-[52px] flex-row items-center justify-center gap-2 rounded-lg bg-lime-500"
        >
          <Plus size={18} color="#0A0A0B" strokeWidth={2} />
          <Text className="font-sans-semibold text-[16px] text-ink-950">Declarar viaje</Text>
        </PressableScale>
        )}
      </View>
      ) : null}
    </SafeAreaView>
  );
}
