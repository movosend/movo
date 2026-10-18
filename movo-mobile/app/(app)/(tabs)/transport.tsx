import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  ArrowRight,
  ChevronDown,
  ChevronsUpDown,
  MapPin,
  PackageX,
  Radar,
  Route,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { CarrierRequirementGate } from "../../../components/carrier/carrier-requirement-gate";
import { CarrierRequirementsScreen } from "../../../components/carrier/carrier-requirements-checklist";
import { useCarrierEligibility } from "../../../src/hooks/use-carrier-eligibility";
import { AddressSearchSheet } from "../../../components/send/address-search-sheet";
import { AvailableShipmentCard } from "../../../components/transport/available-shipment-card";
import { AvailableShipmentRow } from "../../../components/transport/available-shipment-row";
import { TrackingActiveIndicator } from "../../../components/location/tracking-active-indicator";
import { PressableScale } from "../../../components/trips/pressable-scale";
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
import type { MyOfferSummary } from "../../../src/api/offers-client";
import type { AvailableShipment } from "../../../src/api/shipments-client";
import { useAddresses } from "../../../src/hooks/use-addresses";
import { useMyOffers } from "../../../src/hooks/use-offers";
import { useMpConnectStatus } from "../../../src/hooks/use-mp-connect";
import { useMyProfile } from "../../../src/hooks/use-profile";
import { useTabBarScrollHandler } from "../../../src/store/tab-bar-store";
import { TRANSPORT_RADIUS_OPTIONS_KM, useAvailableShipments } from "../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useTransportOrigin } from "../../../src/hooks/use-transport-origin";
import { useTransportRadius } from "../../../src/hooks/use-transport-radius";
import { TripStatus } from "../../../src/api/trips-client";
import { useMyTrips, useTrip, useTripMatches } from "../../../src/hooks/use-trips";
import {
  IDENTITY_GATE_COPY,
  resolveTransportGate,
} from "../../../src/lib/carrier-requirements";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import {
  computeOnTripDetour,
  isPickupWindowExpired,
  shortAddressLabel,
  zoneLabelFromAddress,
} from "../../../src/lib/shipment-format";

/** Skeleton del modo filtrado por viaje (MOVO-163) -- sigue usando `AvailableShipmentCard`
 * (card individual, sin tocar), así que el placeholder mantiene su forma de bloque
 * redondeado. */
function TransportCardSkeleton() {
  return (
    <View className="gap-3 px-5 pt-2">
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} className="h-[132px] rounded-[16px]" />
      ))}
    </View>
  );
}

/** Skeleton del feed genérico (rediseño MOVO-183, lista sin cards) -- mismo layout
 * que `AvailableShipmentRow` (eyebrow chico, título, subtítulo, divisor entre filas y
 * el pill de precio a la derecha), no bloques redondeados sueltos: el placeholder
 * anterior (heredado de cuando el feed usaba `AvailableShipmentCard`) prometía cards
 * que ya no se renderizan, y el salto entre "lo que se ve cargando" y "lo que aparece"
 * quedaba raro (feedback de usuario). */
function TransportRowSkeleton() {
  return (
    <View className="px-5 pt-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          className={`flex-row items-stretch justify-between gap-3 py-[18px] ${
            i === 0 ? "" : "border-t border-border"
          }`}
        >
          <View className="flex-1 gap-2 pr-2">
            <Block className="h-[13px] w-14 rounded-full" />
            <Block className="h-[19px] w-32 rounded-md" />
            <Block className="h-[13px] w-44 rounded-md" />
          </View>
          <View className="justify-center">
            <Block className="h-[48px] w-[78px] rounded-[12px]" />
          </View>
        </View>
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
        className={`h-[34px] w-[34px] items-center justify-center rounded-full ${filterCount > 0 ? "bg-fg" : "bg-bg-mute"
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
// Pasado este tiempo sin refrescar, ganar foco vuelve a pedir perfil + MP aunque no haya bloqueo.
const GATE_STALE_MS = 30_000;

export default function TransportScreen() {
  const tabBarScroll = useTabBarScrollHandler();
  const colors = useThemeColors();
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  // Único punto que deriva el modo de `tripId` — el resto de los flags (isReady,
  // isInitialLoading, canExpandRadius, showOriginSkeleton, JSX) lo consumen a él en
  // vez de re-chequear `tripId`/`!tripId` cada uno por su cuenta.
  const isTripMode = Boolean(tripId);

  // MOVO-167 / MOVO-117: gating de entrada por identidad, licencia y Mercado Pago, sobre el
  // perfil propio y el estado de MP. Es solo UX -- el backend sigue siendo la autoridad
  // (ADR-036). Mientras alguna de las dos consultas carga, falló o el usuario está bloqueado
  // no se resuelve el origen (evita pedir permiso de GPS a quien igual no va a poder ver el
  // listado) ni se piden envíos. Si no se puede consultar el perfil o MP no se deja pasar:
  // sin ellos no se sabe qué falta, así que se muestra el error con "Reintentar".
  const {
    data: profile,
    isLoading: isProfileLoading,
    isError: isProfileError,
    error: profileError,
    dataUpdatedAt: profileUpdatedAt,
    refetch: refetchProfile,
  } = useMyProfile();
  const {
    data: mpConnect,
    isLoading: isMpLoading,
    isError: isMpError,
    error: mpError,
    dataUpdatedAt: mpUpdatedAt,
    refetch: refetchMp,
  } = useMpConnectStatus();
  const eligibilityQuery = useCarrierEligibility();
  const profileGate = resolveTransportGate({
    kycStatus: profile?.kycStatus ?? null,
    licenseKycStatus: profile?.licenseKycStatus ?? null,
    mpStatus: mpConnect?.status ?? null,
    debtOverdue: eligibilityQuery.data?.missingRequirements.includes("no_overdue_debt") ?? false,
  });
  // Sin identidad aprobada la checklist no se muestra, así que MP no hace falta para decidir.
  const profileUnavailable = !profile && isProfileError;
  const mpUnavailable = !mpConnect && isMpError && profileGate !== "identity";
  const eligibilityUnavailable = !eligibilityQuery.data && eligibilityQuery.isError && profileGate !== "identity";
  const requirementsError = profileUnavailable ? profileError : mpUnavailable ? mpError : eligibilityQuery.error;
  const isRequirementsLoading = isProfileLoading || (isMpLoading && profileGate !== "identity") || (eligibilityQuery.isLoading && profileGate !== "identity");
  const canBrowse = !isRequirementsLoading && !(profileUnavailable || mpUnavailable || eligibilityUnavailable) && profileGate === null;

  const { origin, resolving, needsManualPick, setManualSelection } = useTransportOrigin(!isTripMode && canBrowse);
  const { radiusKm, setRadiusKm } = useTransportRadius();
  const { data: savedAddresses } = useAddresses(!isTripMode && canBrowse);
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
  } = useTrip(canBrowse ? tripId : undefined);
  const availableQuery = useAvailableShipments(canBrowse ? origin : null, radiusKm);
  const matchesQuery = useTripMatches(canBrowse ? tripId : undefined);
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

  // El perfil puede estar cacheado viejo; el 403 `CARRIER_NOT_VERIFIED` del feed no.
  const identityRejectedByFeed = isError && error instanceof ApiError && error.code === "CARRIER_NOT_VERIFIED";
  const gate = identityRejectedByFeed ? "identity" : profileGate;
  // Si el feed ya rechazó por identidad, el error de MP no corresponde: manda el gate de
  // identidad (que no necesita MP). `mpUnavailable` de arriba solo decide qué se consulta.
  const requirementsUnavailable = profileUnavailable || ((mpUnavailable || eligibilityUnavailable) && gate !== "identity");

  // Al volver de `/kyc`, `/license-kyc` o `/profile/payments` el tab sigue montado: sin este
  // refetch el bloqueo quedaría con el estado viejo hasta reabrir la app. Con un bloqueo (o
  // un error de requisitos) activo corre siempre al ganar foco; sin bloqueo solo si los datos
  // tienen más de `GATE_STALE_MS` (el estado puede haber cambiado desde otra pantalla, ej. se
  // desvinculó MP, pero no hace falta pedirlo en cada foco). Si el bloqueo vino del feed
  // también hay que volver a pedirlo, el perfil solo no lo destraba. Lee el estado de un ref
  // para que el callback no cambie con cada render y `useFocusEffect` no lo vuelva a
  // correr sin que la pantalla haya ganado foco.
  const refreshGate = useCallback(async () => {
    const tasks: Promise<unknown>[] = [refetchProfile(), refetchMp(), eligibilityQuery.refetch()];
    if (identityRejectedByFeed) tasks.push(refetch());
    await Promise.all(tasks);
  }, [refetchProfile, refetchMp, eligibilityQuery.refetch, refetch, identityRejectedByFeed]);
  const isGateStale = Date.now() - Math.min(profileUpdatedAt, mpUpdatedAt, eligibilityQuery.dataUpdatedAt) > GATE_STALE_MS;
  const shouldRefreshOnFocus = gate !== null || requirementsUnavailable || isGateStale;
  const focusRefreshRef = useRef({ refreshGate, shouldRefreshOnFocus });
  focusRefreshRef.current = { refreshGate, shouldRefreshOnFocus };
  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      // El primer foco coincide con el montaje: las queries ya arrancan solas.
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      if (focusRefreshRef.current.shouldRefreshOnFocus) void focusRefreshRef.current.refreshGate();
    }, []),
  );
  // Pull-to-refresh del estado bloqueante: si un requisito se resuelve con el usuario
  // parado en el tab no hay evento de foco que lo destrabe.
  const [isRefreshingGate, setIsRefreshingGate] = useState(false);
  const onRefreshGate = useCallback(async () => {
    setIsRefreshingGate(true);
    try {
      await refreshGate();
    } finally {
      setIsRefreshingGate(false);
    }
  }, [refreshGate]);
  // Filtro client-side de envíos con la ventana de retiro ya vencida — el backend
  // no los excluye (ver `isPickupWindowExpired`), en ninguno de los dos modos.
  const unexpiredItems = (data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => !isPickupWindowExpired(item.pickupDate, item.pickupTimeWindowEnd),
  );

  // MOVO-221: la franja "de paso" se alimenta de los viajes `declared` (pendientes de
  // iniciar), no `active` -- con el límite de 1 viaje `active` por cuenta que trajo
  // ese ticket, cruzar el feed contra `active` solo cubriría como mucho un viaje a la
  // vez. Los `declared` (que siguen siendo N) son los que de verdad describen "todos
  // los trayectos que este transportista tiene pensados".
  const declaredTrips = useMemo(
    () => (myTripsData?.items ?? []).filter((t) => t.status === TripStatus.DECLARED),
    [myTripsData],
  );
  // Sin merge de "on-trip" en modo viaje: ya está filtrado por UN solo corredor
  // (`GET /trips/:id/matches`), mostrar una franja de desvío redundante ahí no aporta.
  const itemsWithDetour = useMemo(
    () =>
      unexpiredItems.map((item) => ({
        item,
        detour: isTripMode ? null : computeOnTripDetour(item, declaredTrips, ON_TRIP_MAX_DETOUR_KM),
      })),
    [unexpiredItems, declaredTrips, isTripMode],
  );
  const offers = myOffersData?.items ?? [];
  // `GET /offers/mine` trae TODO el historial (incluidas retiradas/rechazadas/
  // vencidas/superadas, ver "Todas tus ofertas" en carrier/offers/index.tsx) -- acá
  // solo interesan las activas. Un envío puede tener más de una oferta propia en el
  // historial (ej. retiró una y ofertó de nuevo); entre las activas se prioriza la
  // aceptada sobre la pendiente.
  const offersByShipmentId = useMemo(() => {
    const map = new Map<string, MyOfferSummary>();
    for (const offer of offers) {
      if (offer.status !== OfferStatus.PENDING && offer.status !== OfferStatus.ACCEPTED) continue;
      const existing = map.get(offer.shipmentId);
      if (!existing || existing.status !== OfferStatus.ACCEPTED) {
        map.set(offer.shipmentId, offer);
      }
    }
    return map;
  }, [offers]);
  // Los envíos donde ya se ofertó ya no se sacan del feed -- pedido explícito del
  // usuario (antes vivían solo en "Mis ofertas", MOVO-149/183): se muestran en la
  // MISMA lista, siempre al final (`sortedItems` abajo hace el split), con el pill de
  // precio en gris (no el sugerido) y un indicador de si la oferta fue aceptada.
  const filteredItems = useMemo(
    () => applyTransportFilters(itemsWithDetour, filters),
    [itemsWithDetour, filters],
  );
  const sortedItems = useMemo(() => {
    if (isTripMode) return filteredItems;
    const withoutOffer = filteredItems.filter(({ item }) => !item.hasMyOffer);
    const withOffer = filteredItems.filter(({ item }) => item.hasMyOffer);
    return [...sortTransportItems(withoutOffer, sortMode), ...sortTransportItems(withOffer, sortMode)];
  }, [filteredItems, sortMode, isTripMode]);
  const filterCount = transportFilterCount(filters);
  const showOnlyOnTripToggle = !isTripMode && declaredTrips.length > 0;

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

  const showOriginSkeleton = canBrowse && !isTripMode && (resolving || (origin === null && !needsManualPick));
  const isInitialLoading =
    isRequirementsLoading ||
    (isTripMode ? isTripLoading || (isReady && isLoading) : showOriginSkeleton || (isReady && isLoading));

  // MOVO-221: con el límite de 1 viaje `active` por cuenta, mostrar "N activos ·
  // M declarados" ya no aporta nada (activos es siempre 0 o 1) -- el acceso "Mis
  // viajes" pasa a mostrar solo la cuenta de declarados (los pendientes de iniciar).
  // `offers` ya se declara más arriba (MOVO-182, split de useMyOffers por status).
  const tripsMeta = `${declaredTrips.length} ${declaredTrips.length === 1 ? "declarado" : "declarados"}`;
  const pendingOffersCount = offers.filter((o) => o.status === OfferStatus.PENDING).length;
  const acceptedOffersCount = offers.filter((o) => o.status === OfferStatus.ACCEPTED).length;
  const offersMeta = `${pendingOffersCount} ${pendingOffersCount === 1 ? "pendiente" : "pendientes"} · ${acceptedOffersCount} ${acceptedOffersCount === 1 ? "aceptada" : "aceptadas"}`;

  // Con un requisito pendiente solo queda el título (y, fuera del modo `?tripId=`, el
  // indicador de tracking, que no depende del bloqueo): zona, accesos, radio y filtros
  // no sirven sin poder ver envíos.
  const showBrowseChrome = canBrowse && gate === null;
  const showRequirementsGate = !isInitialLoading && !requirementsUnavailable && Array.isArray(gate);
  const isGateOverlayVisible = showRequirementsGate && !!profile;
  const zoneLabel = origin ? origin.city ?? zoneLabelFromAddress(origin.address) : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      {/* Con la checklist visible el contenido de atrás queda fuera del árbol de accesibilidad. */}
      <View
        className="flex-1"
        accessibilityElementsHidden={isGateOverlayVisible}
        importantForAccessibility={isGateOverlayVisible ? "no-hide-descendants" : "auto"}
      >
      <View className="px-5 pb-4 pt-3">
        <View className="min-h-[40px] flex-row items-center justify-between gap-3">
          <Text className="font-sans-semibold text-title text-fg" accessibilityRole="header">
            Transportar
          </Text>
          {showBrowseChrome && !isTripMode && zoneLabel ? (
            <PressableScale
              testID="transport-zone-chip"
              onPress={() => setPickerOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Envíos cerca de ${zoneLabel}. Cambiar zona`}
              style={{ maxWidth: 180, flexShrink: 1 }}
              className="flex-row items-center gap-1.5 rounded-full border border-border bg-bg-sub py-2 pl-2.5 pr-3"
            >
              <MapPin size={14} strokeWidth={2} color={colors.fg1} />
              <Text numberOfLines={1} style={{ flexShrink: 1 }} className="font-sans-medium text-[13px] text-fg">
                {zoneLabel}
              </Text>
              <ChevronDown size={14} strokeWidth={1.8} color={colors.fg3} />
            </PressableScale>
          ) : null}
        </View>
        {showBrowseChrome && isTripMode && trip ? (
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

      {!isTripMode ? <TrackingActiveIndicator className="mx-5 mb-3" /> : null}

      {showBrowseChrome && !isTripMode ? (
        <>
          <PressableScale
            testID="transport-my-route-cta"
            // expo-router no infiere la ruta raíz `/route` cuando se navega desde un grupo anidado (tabs); la ruta existe en app/(app)/route/index.tsx
            onPress={() => router.push("/route" as any)}
            accessibilityRole="button"
            className="mx-5 mb-3 flex-row items-center justify-between rounded-[10px] border border-border bg-bg-sub p-3.5"
          >
            <View className="flex-row items-center gap-3">
              <View className="h-8 w-8 items-center justify-center rounded-full bg-lime-500/20">
                <Route size={16} strokeWidth={2} color={colors.fg1} />
              </View>
              <View>
                <Text className="font-sans-semibold text-[14px] text-fg">Mi ruta de hoy</Text>
                <Text className="font-sans text-[11.5px] text-fg-3">Mapa y paradas optimizadas</Text>
              </View>
            </View>
            <ArrowRight size={15} strokeWidth={1.8} color={colors.fg2} />
          </PressableScale>

          <TransportAccessCards
            tripsMeta={tripsMeta}
            offersMeta={offersMeta}
            offersNeedAttention={acceptedOffersCount > 0}
            onPressTrips={() => router.push("/carrier/trips" as any)}
            onPressOffers={() => router.push("/carrier/offers" as any)}
          />
        </>
      ) : null}

      {showBrowseChrome && !isTripMode && origin ? (
        <RadiusAndFiltersRow
          radiusKm={radiusKm}
          onChangeRadius={setRadiusKm}
          filterCount={filterCount}
          onOpenFilters={() => setFiltersOpen(true)}
        />
      ) : null}

      {isInitialLoading ? (
        isTripMode ? <TransportCardSkeleton /> : <TransportRowSkeleton />
      ) : requirementsUnavailable ? (
        <View className="px-5 pt-2">
          <ErrorBanner
            testID="transport-profile-error"
            message={friendlyErrorMessage(requirementsError, "No pudimos verificar tus requisitos para transportar.")}
          />
          <Text onPress={() => void refreshGate()} className="font-sans-medium text-small text-fg">
            Reintentar
          </Text>
        </View>
      ) : gate === "identity" || (gate !== null && !profile) ? (
        <ScrollView
          testID="transport-gate-scroll"
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              testID="transport-gate-refresh"
              refreshing={isRefreshingGate}
              onRefresh={onRefreshGate}
            />
          }
        >
          <CarrierRequirementGate
            testID="transport-identity-gate"
            icon={ShieldAlert}
            {...IDENTITY_GATE_COPY}
            onPressCta={() => router.push("/kyc")}
          />
        </ScrollView>
      ) : gate !== null && profile ? (
        // La checklist se monta abajo, sobre todo el tab (incluido el título); atrás van
        // filas en esqueleto para que el fondo no quede en blanco.
        <TransportRowSkeleton />
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
        isTripMode ? <TransportCardSkeleton /> : <TransportRowSkeleton />
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
          {...tabBarScroll}
          testID="transport-list"
          data={sortedItems}
          keyExtractor={({ item }) => item.id}
          contentContainerStyle={
            isTripMode
              ? { paddingHorizontal: 20, paddingBottom: 24, gap: 12 }
              : { paddingHorizontal: 20, paddingBottom: 24 }
          }
          ItemSeparatorComponent={isTripMode ? undefined : () => <View className="h-px bg-border" />}
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
          renderItem={({ item: { item, detour } }) =>
            isTripMode ? (
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
            ) : (
              <AvailableShipmentRow
                shipment={item}
                testID={`transport-card-${item.id}`}
                detour={detour ? { detourKm: detour.detourKm } : null}
                // Gateado por `item.hasMyOffer` (calculado por el backend, no por
                // este cache local) -- evita mostrar una oferta ya retirada/
                // rechazada/vencida que igual siga en el historial de `useMyOffers`.
                myOffer={item.hasMyOffer ? offersByShipmentId.get(item.id) ?? null : null}
              />
            )
          }
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

      </View>

      {showRequirementsGate && profile && Array.isArray(gate) ? (
        <CarrierRequirementsScreen
          testID="transport-requirements-gate"
          missing={gate}
          licenseStatus={profile.licenseKycStatus}
          mpStatus={mpConnect?.status ?? null}
          context="gate"
          refreshing={isRefreshingGate}
          onRefresh={onRefreshGate}
          onPressLicense={() =>
            router.push({ pathname: "/license-kyc", params: { status: profile.licenseKycStatus } })
          }
          onPressMp={() => router.push("/profile/payments?tab=methods")}
          onPressDebt={() => router.push("/profile/payments?tab=balance&pay=1")}
          onLater={() => router.navigate("/home")}
        />
      ) : null}

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
