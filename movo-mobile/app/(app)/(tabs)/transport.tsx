import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowRight,
  ChevronDown,
  ChevronsUpDown,
  MapPin,
  PackageX,
  Radar,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddressSearchSheet } from "../../../components/send/address-search-sheet";
import { AvailableShipmentCard } from "../../../components/transport/available-shipment-card";
import { TransportAccessCards } from "../../../components/transport/transport-access-cards";
import {
  DEFAULT_TRANSPORT_FILTERS,
  ON_TRIP_MAX_DETOUR_KM,
  TransportFiltersSheet,
  transportFilterCount,
  type TransportFilters,
} from "../../../components/transport/transport-filters-sheet";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { SkeletonBlock as Block } from "../../../components/ui/skeleton-block";
import type { AvailableShipment } from "../../../src/api/shipments-client";
import { useAddresses } from "../../../src/hooks/use-addresses";
import { useMyOffers } from "../../../src/hooks/use-offers";
import { TRANSPORT_RADIUS_OPTIONS_KM, useAvailableShipments } from "../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useTransportOrigin } from "../../../src/hooks/use-transport-origin";
import { useTransportRadius } from "../../../src/hooks/use-transport-radius";
import { TripStatus } from "../../../src/api/trips-client";
import { useMyTrips, useTrip, useTripMatches } from "../../../src/hooks/use-trips";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import {
  computeOnTripDetour,
  isPickupWindowExpired,
  shortAddressLabel,
  zoneLabelFromAddress,
} from "../../../src/lib/shipment-format";

function TransportListSkeleton() {
  return (
    <View className="gap-3 px-5 pt-2">
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} className="h-[132px] rounded-[16px]" />
      ))}
    </View>
  );
}

function RadiusAndFiltersRow({
  radiusKm,
  onChangeRadius,
  filterCount,
  onOpenFilters,
}: {
  radiusKm: number;
  onChangeRadius: (value: number) => void;
  filterCount: number;
  onOpenFilters: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-2 px-5 pb-4">
      <View className="flex-1 flex-row gap-2">
        {TRANSPORT_RADIUS_OPTIONS_KM.map((option) => {
          const selected = option === radiusKm;
          return (
            <Pressable
              key={option}
              testID={`transport-radius-${option}`}
              onPress={() => onChangeRadius(option)}
              className={`rounded-full px-4 py-2 ${selected ? "bg-fg" : "bg-bg-mute"}`}
            >
              <Text className={`font-sans-medium text-small ${selected ? "text-bg" : "text-fg-2"}`}>
                {option} km
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        testID="transport-open-filters"
        onPress={onOpenFilters}
        className={`h-[34px] w-[34px] items-center justify-center rounded-full ${
          filterCount > 0 ? "bg-fg" : "bg-bg-mute"
        }`}
      >
        <SlidersHorizontal size={16} strokeWidth={1.8} color={filterCount > 0 ? colors.bg : colors.fg1} />
        {filterCount > 0 ? (
          <View
            testID="transport-filter-count-badge"
            className="absolute -right-1 -top-1 h-4 min-w-[16px] items-center justify-center rounded-full bg-lime-500 px-1"
          >
            <Text className="font-sans-semibold text-[10px] text-ink-950">{filterCount}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

type TransportSortMode = "detour" | "pay" | "soon";
const TRANSPORT_SORT_ORDER: TransportSortMode[] = ["detour", "pay", "soon"];
const TRANSPORT_SORT_LABELS: Record<TransportSortMode, string> = {
  detour: "Menos desvío",
  pay: "Mejor pago",
  soon: "Más próximo",
};

function ResultsSortRow({
  resultsLabel,
  sortMode,
  onCycleSort,
}: {
  resultsLabel: string;
  sortMode: TransportSortMode;
  onCycleSort: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-baseline justify-between border-t border-border pb-3 pt-5">
      <Text
        testID="transport-results-label"
        className="font-sans-semibold text-[11px] uppercase tracking-wide text-fg-2"
      >
        {resultsLabel}
      </Text>
      <Pressable testID="transport-sort-cycle" onPress={onCycleSort} className="flex-row items-center gap-1">
        <Text className="font-sans-medium text-[12px] text-fg">{TRANSPORT_SORT_LABELS[sortMode]}</Text>
        <ChevronsUpDown size={12} strokeWidth={1.8} color={colors.fg1} />
      </Pressable>
    </View>
  );
}

function sortTransportItems<T>(
  itemsWithDetour: { item: AvailableShipment; detour: { trip: T; detourKm: number } | null }[],
  sortMode: TransportSortMode,
) {
  const sorted = [...itemsWithDetour];
  sorted.sort((a, b) => {
    if (sortMode === "pay") return (b.item.suggestedPriceArs ?? 0) - (a.item.suggestedPriceArs ?? 0);
    if (sortMode === "soon") {
      const aKey = `${a.item.pickupDate}T${a.item.pickupTimeWindowStart}`;
      const bKey = `${b.item.pickupDate}T${b.item.pickupTimeWindowStart}`;
      return aKey.localeCompare(bKey);
    }
    const aDetour = a.detour ? a.detour.detourKm : Infinity;
    const bDetour = b.detour ? b.detour.detourKm : Infinity;
    return aDetour - bDetour;
  });
  return sorted;
}

function applyTransportFilters<T>(
  itemsWithDetour: { item: AvailableShipment; detour: { trip: T; detourKm: number } | null }[],
  filters: TransportFilters,
) {
  return itemsWithDetour.filter(({ item, detour }) => {
    if (filters.onlyOnTrip && !detour) return false;
    if (filters.hideOffered && item.hasMyOffer) return false;
    if (filters.types.length > 0 && !filters.types.includes(item.packageType)) return false;
    if (filters.minPayArs > 0 && (item.suggestedPriceArs ?? 0) < filters.minPayArs) return false;
    if (filters.maxWeightKg > 0 && item.weightKg > filters.maxWeightKg) return false;
    return true;
  });
}

/**
 * Tab "Transportar" (MOVO-148) — reemplaza el placeholder de MOVO-78. Lista los
 * envíos disponibles cerca del transportista (`GET /shipments/available`, MOVO-142),
 * ordenados por distancia, con radio configurable y persistido.
 *
 * MOVO-163: con `?tripId=` en la URL (desde "Mis viajes"), esta misma pantalla pasa a
 * modo "filtrado por viaje" — fuente de datos `GET /trips/:id/matches` en vez de
 * `/shipments/available`, sin selector de radio/origen/GPS (el filtro es por el
 * corredor del viaje, no por cercanía al usuario). Reusa tal cual el resto de la UI
 * (skeleton, error/gating KYC, `FlatList` con `AvailableShipmentCard`,
 * pull-to-refresh/scroll infinito) — no se duplica la pantalla.
 *
 * MOVO-183 (rediseño, prototipo de Claude Design "Transportista - Transportar"):
 * header mínimo con chip de zona (sheet en vez de "Cambiar" suelto), dos accesos con
 * contador ("Mis viajes"/"Mis ofertas", MOVO-162/149 respectivamente — el tab bar de
 * abajo ya no navega a ninguno), botón de filtros con badge (sheet nuevo,
 * `TransportFiltersSheet` — tipo/pago mínimo/peso máximo son 100% client-side, sin
 * soporte del backend, mismo criterio ya aceptado en "Mis Envíos" MOVO-113) y la card
 * con la jerarquía nueva (ruta sobre timeline, franja de desvío cuando el envío queda
 * de paso en un viaje declarado — `computeOnTripDetour`, aproximación client-side sin
 * endpoint que cruce el feed general contra los viajes activos).
 */
export default function TransportScreen() {
  const colors = useThemeColors();
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  // Único punto que deriva el modo de `tripId` — el resto de los flags (isReady,
  // isInitialLoading, canExpandRadius, showOriginSkeleton, JSX) lo consumen a él en
  // vez de re-chequear `tripId`/`!tripId` cada uno por su cuenta.
  const isTripMode = Boolean(tripId);
  const { origin, resolving, needsManualPick, setManualSelection } = useTransportOrigin(!isTripMode);
  const { radiusKm, setRadiusKm } = useTransportRadius();
  const { data: savedAddresses } = useAddresses(!isTripMode);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<TransportFilters>(DEFAULT_TRANSPORT_FILTERS);
  const [sortMode, setSortMode] = useState<TransportSortMode>("detour");

  const { data: myTripsData } = useMyTrips();
  const { data: myOffersData } = useMyOffers({ limit: 50 });

  const {
    data: trip,
    isLoading: isTripLoading,
    isError: isTripError,
    error: tripError,
    refetch: refetchTrip,
  } = useTrip(tripId);
  const availableQuery = useAvailableShipments(origin, radiusKm);
  const matchesQuery = useTripMatches(tripId);
  const {
    data,
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = isTripMode ? matchesQuery : availableQuery;

  // AC2: sin GPS ni dirección default, el selector manual se abre solo — sigue
  // pudiéndose reabrir después a mano desde el chip de zona (mismo estado, `pickerOpen`).
  useEffect(() => {
    if (needsManualPick) setPickerOpen(true);
  }, [needsManualPick]);

  const isGatedByKyc = isError && error instanceof ApiError && error.code === "CARRIER_NOT_VERIFIED";
  // Filtro client-side de envíos con la ventana de retiro ya vencida — el backend
  // no los excluye (ver `isPickupWindowExpired`), en ninguno de los dos modos.
  const unexpiredItems = (data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => !isPickupWindowExpired(item.pickupDate, item.pickupTimeWindowEnd),
  );

  const activeTrips = useMemo(
    () => (myTripsData?.items ?? []).filter((t) => t.status === TripStatus.ACTIVE),
    [myTripsData],
  );
  // Sin merge de "on-trip" en modo viaje: ya está filtrado por UN solo corredor
  // (`GET /trips/:id/matches`), mostrar una franja de desvío redundante ahí no aporta.
  const itemsWithDetour = useMemo(
    () =>
      unexpiredItems.map((item) => ({
        item,
        detour: isTripMode ? null : computeOnTripDetour(item, activeTrips, ON_TRIP_MAX_DETOUR_KM),
      })),
    [unexpiredItems, activeTrips, isTripMode],
  );
  const filteredItems = useMemo(() => applyTransportFilters(itemsWithDetour, filters), [itemsWithDetour, filters]);
  const sortedItems = useMemo(
    () => (isTripMode ? filteredItems : sortTransportItems(filteredItems, sortMode)),
    [filteredItems, sortMode, isTripMode],
  );
  const filterCount = transportFilterCount(filters);
  const showOnlyOnTripToggle = !isTripMode && activeTrips.length > 0;

  // "Listo para mostrar datos": en modo viaje depende de que el detalle del viaje ya
  // resolvió (para el header de AC2); en modo genérico, del origen (GPS/default/
  // manual) — reemplaza el `origin !== null` que antes gateaba todo el render.
  const isReady = isTripMode ? !!trip : origin !== null;

  // Si una página entera vino con todos sus ítems vencidos, el filtro de arriba puede
  // dejar la lista sin filtros de usuario vacía aunque el servidor todavía tenga más
  // páginas — sin esto se mostraría el estado vacío pudiendo haber envíos vigentes más
  // adelante. Cascadea solo sobre el filtro de vencidos (siempre activo), nunca sobre
  // los filtros opcionales del usuario (radio/tipo/pago/peso) — un filtro que el
  // usuario eligió a propósito puede dar 0 resultados legítimamente.
  const shouldCascadeNextPage = isReady && !isLoading && !isError && unexpiredItems.length === 0 && hasNextPage;
  useEffect(() => {
    if (shouldCascadeNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [shouldCascadeNextPage, isFetchingNextPage, fetchNextPage]);

  const currentRadiusIndex = TRANSPORT_RADIUS_OPTIONS_KM.indexOf(
    radiusKm as (typeof TRANSPORT_RADIUS_OPTIONS_KM)[number],
  );
  // Sin selector de radio en modo viaje (MOVO-163) — "ampliar radio" no aplica.
  const canExpandRadius =
    !isTripMode && currentRadiusIndex >= 0 && currentRadiusIndex < TRANSPORT_RADIUS_OPTIONS_KM.length - 1;

  const showOriginSkeleton = !isTripMode && (resolving || (origin === null && !needsManualPick));
  const isInitialLoading = isTripMode
    ? isTripLoading || (isReady && isLoading)
    : showOriginSkeleton || (isReady && isLoading);

  const trips = myTripsData?.items ?? [];
  const tripsMeta = `${activeTrips.length} ${activeTrips.length === 1 ? "activo" : "activos"} · ${trips.length} ${trips.length === 1 ? "declarado" : "declarados"}`;
  const offers = myOffersData?.items ?? [];
  const pendingOffersCount = offers.filter((o) => o.status === OfferStatus.PENDING).length;
  const acceptedOffersCount = offers.filter((o) => o.status === OfferStatus.ACCEPTED).length;
  const offersMeta = `${pendingOffersCount} ${pendingOffersCount === 1 ? "pendiente" : "pendientes"} · ${acceptedOffersCount} ${acceptedOffersCount === 1 ? "aceptada" : "aceptadas"}`;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="px-5 pb-4 pt-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-sans-semibold text-title text-fg">Transportar</Text>
          {!isTripMode && origin ? (
            <Pressable
              testID="transport-zone-chip"
              onPress={() => setPickerOpen(true)}
              style={{ maxWidth: 150, flexShrink: 1 }}
              className="flex-row items-center gap-1 self-start rounded-full border border-border bg-bg-mute px-2.5 py-1.5"
            >
              <MapPin size={12} strokeWidth={1.8} color={colors.fg3} />
              <Text
                numberOfLines={1}
                style={{ flexShrink: 1 }}
                className="font-sans-medium text-[12px] text-fg"
              >
                {origin.city ?? zoneLabelFromAddress(origin.address)}
              </Text>
              <ChevronDown size={12} strokeWidth={1.8} color={colors.fg3} />
            </Pressable>
          ) : null}
        </View>
        {isTripMode && trip ? (
          <View className="mt-1 flex-row items-center gap-1.5">
            <MapPin size={13} strokeWidth={1.8} color={colors.fg3} />
            <Text testID="transport-trip-filter-label" className="flex-1 font-sans text-small text-fg-2" numberOfLines={1}>
              Filtrado por viaje: {shortAddressLabel(trip.originAddress)} → {shortAddressLabel(trip.destinationAddress)}
            </Text>
            <Text
              testID="transport-clear-trip-filter"
              onPress={() => router.replace("/(app)/(tabs)/transport")}
              className="font-sans-medium text-small text-fg"
            >
              Ver todos
            </Text>
          </View>
        ) : null}
      </View>

      {!isTripMode ? (
        <TransportAccessCards
          tripsMeta={tripsMeta}
          offersMeta={offersMeta}
          offersNeedAttention={acceptedOffersCount > 0}
          onPressTrips={() => router.push("/carrier/trips" as any)}
          onPressOffers={() => router.push("/carrier/offers" as any)}
        />
      ) : null}

      {!isTripMode && origin ? (
        <RadiusAndFiltersRow
          radiusKm={radiusKm}
          onChangeRadius={setRadiusKm}
          filterCount={filterCount}
          onOpenFilters={() => setFiltersOpen(true)}
        />
      ) : null}

      {isInitialLoading ? (
        <TransportListSkeleton />
      ) : isTripMode && isTripError ? (
        <View className="px-5 pt-2">
          <ErrorBanner
            testID="transport-trip-error"
            message={friendlyErrorMessage(tripError, "No pudimos cargar el viaje.")}
          />
          <Text onPress={() => refetchTrip()} className="font-sans-medium text-small text-fg">
            Reintentar
          </Text>
        </View>
      ) : isGatedByKyc ? (
        <View className="items-center gap-2 px-8 py-10">
          <ShieldAlert size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans-medium text-body text-fg">
            Verificá tu identidad para transportar
          </Text>
          <Text className="text-center font-sans text-small text-fg-2">
            Necesitás tu identidad verificada para ver y aceptar envíos disponibles.
          </Text>
          <Text
            testID="transport-verify-kyc"
            onPress={() => router.push("/kyc")}
            className="mt-2 font-sans-medium text-small text-fg"
          >
            Verificar identidad
          </Text>
        </View>
      ) : isError ? (
        <View className="px-5 pt-2">
          <ErrorBanner
            testID="transport-list-error"
            message={friendlyErrorMessage(error, "No pudimos cargar los envíos disponibles.")}
          />
          <Text onPress={() => refetch()} className="font-sans-medium text-small text-fg">
            Reintentar
          </Text>
        </View>
      ) : shouldCascadeNextPage ? (
        <TransportListSkeleton />
      ) : isReady && sortedItems.length === 0 ? (
        isTripMode ? (
          <View className="items-center gap-2 px-5 py-10">
            <PackageX size={22} strokeWidth={1.8} color={colors.fg3} />
            <Text className="mt-2 text-center font-sans-semibold text-body text-fg">
              Ningún paquete compatible con este viaje todavía.
            </Text>
          </View>
        ) : (
          <View className="px-5 pt-4">
            <View className="items-center py-6">
              <View className="h-[64px] w-[64px] items-center justify-center rounded-full bg-ink-950">
                <Radar size={26} strokeWidth={1.8} color="#C6F24A" />
              </View>
            </View>
            <Text className="mt-5 text-center font-sans-semibold text-[19px] text-fg">
              {filterCount > 0 ? "Nada con estos filtros" : `Todo tranquilo en ${radiusKm} km`}
            </Text>
            <Text className="mx-auto mt-2 max-w-[290px] text-center font-sans text-small text-fg-2">
              {filterCount > 0
                ? "Con los filtros que pusiste no hay nada. Probá sacando alguno o mirá más lejos."
                : "Todavía no hay envíos publicados cerca. Ampliá el radio o esperá un rato."}
            </Text>
            {filterCount > 0 ? (
              <Pressable
                testID="transport-clear-filters"
                onPress={() => setFilters(DEFAULT_TRANSPORT_FILTERS)}
                className="mt-5 h-[46px] flex-row items-center justify-center gap-2 self-center rounded-lg bg-fg px-6"
              >
                <Text className="font-sans-semibold text-body text-bg">Limpiar filtros</Text>
                <ArrowRight size={17} strokeWidth={1.8} color={colors.bg} />
              </Pressable>
            ) : canExpandRadius ? (
              <Pressable
                testID="transport-expand-radius"
                onPress={() => setRadiusKm(TRANSPORT_RADIUS_OPTIONS_KM[currentRadiusIndex + 1])}
                className="mt-5 h-[46px] flex-row items-center justify-center gap-2 self-center rounded-lg bg-fg px-6"
              >
                <Text className="font-sans-semibold text-body text-bg">
                  Ampliar radio a {TRANSPORT_RADIUS_OPTIONS_KM[currentRadiusIndex + 1]} km
                </Text>
                <ArrowRight size={17} strokeWidth={1.8} color={colors.bg} />
              </Pressable>
            ) : null}
          </View>
        )
      ) : isReady ? (
        <FlatList
          testID="transport-list"
          data={sortedItems}
          keyExtractor={({ item }) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }}
          ListHeaderComponent={
            !isTripMode ? (
              <ResultsSortRow
                resultsLabel={`${sortedItems.length} ${sortedItems.length === 1 ? "envío" : "envíos"} en ${radiusKm} km`}
                sortMode={sortMode}
                onCycleSort={() =>
                  setSortMode(
                    (prev) =>
                      TRANSPORT_SORT_ORDER[(TRANSPORT_SORT_ORDER.indexOf(prev) + 1) % TRANSPORT_SORT_ORDER.length],
                  )
                }
              />
            ) : null
          }
          renderItem={({ item: { item, detour } }) => (
            <AvailableShipmentCard
              shipment={item}
              testID={`transport-card-${item.id}`}
              detour={
                detour
                  ? {
                      onTrip: `${shortAddressLabel(detour.trip.originAddress)} → ${shortAddressLabel(detour.trip.destinationAddress)}`,
                      detourKm: detour.detourKm,
                    }
                  : null
              }
            />
          )}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              void fetchNextPage();
            }
          }}
          refreshControl={
            <RefreshControl testID="transport-refresh" refreshing={isRefetching} onRefresh={() => refetch()} />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="items-center py-4">
                <ActivityIndicator color={colors.fg3} />
              </View>
            ) : null
          }
        />
      ) : null}

      <AddressSearchSheet
        testID="transport-address-picker"
        visible={pickerOpen}
        label="¿Desde dónde salís?"
        savedAddresses={savedAddresses}
        onClose={() => setPickerOpen(false)}
        onSelect={(selection) => {
          setManualSelection(selection);
          setPickerOpen(false);
        }}
      />

      <TransportFiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        applied={filters}
        showOnlyOnTrip={showOnlyOnTripToggle}
        matchCount={(draft) => applyTransportFilters(itemsWithDetour, draft).length}
        onApply={setFilters}
      />
    </SafeAreaView>
  );
}
