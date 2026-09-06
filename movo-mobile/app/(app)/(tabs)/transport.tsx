import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router, useLocalSearchParams } from "expo-router";
import { MapPin, PackageX, ShieldAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddressSearchSheet } from "../../../components/send/address-search-sheet";
import { AvailableShipmentCard } from "../../../components/transport/available-shipment-card";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { SkeletonBlock as Block } from "../../../components/ui/skeleton-block";
import { SuccessBanner } from "../../../components/ui/success-banner";
import { useAddresses } from "../../../src/hooks/use-addresses";
import { TRANSPORT_RADIUS_OPTIONS_KM, useAvailableShipments } from "../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useTransportOrigin } from "../../../src/hooks/use-transport-origin";
import { useTransportRadius } from "../../../src/hooks/use-transport-radius";
import { useTrip, useTripMatches } from "../../../src/hooks/use-trips";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { isPickupWindowExpired, shortAddressLabel, zoneLabelFromAddress } from "../../../src/lib/shipment-format";

function TransportListSkeleton() {
  return (
    <View className="gap-3 px-5 pt-2">
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} className="h-[132px] rounded-[16px]" />
      ))}
    </View>
  );
}

function RadiusPillRow({
  radiusKm,
  onChange,
}: {
  radiusKm: number;
  onChange: (value: number) => void;
}) {
  return (
    <View className="flex-row gap-2 px-5 pb-3">
      {TRANSPORT_RADIUS_OPTIONS_KM.map((option) => {
        const selected = option === radiusKm;
        return (
          <Pressable
            key={option}
            testID={`transport-radius-${option}`}
            onPress={() => onChange(option)}
            className={`rounded-full px-4 py-2 ${selected ? "bg-fg" : "bg-bg-mute"}`}
          >
            <Text className={`font-sans-medium text-small ${selected ? "text-bg" : "text-fg-2"}`}>{option} km</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Tab "Transportar" (MOVO-148) — reemplaza el placeholder de MOVO-78. Lista los
 * envíos disponibles cerca del transportista (`GET /shipments/available`, MOVO-142),
 * ordenados por distancia, con radio configurable y persistido.
 *
 * MOVO-162 agrega el acceso a "Mis viajes" en el header junto al título.
 *
 * MOVO-163: con `?tripId=` en la URL (desde "Mis viajes", MOVO-162), esta misma
 * pantalla pasa a modo "filtrado por viaje" — fuente de datos `GET /trips/:id/matches`
 * en vez de `/shipments/available`, sin selector de radio/origen/GPS (el filtro es por
 * el corredor del viaje, no por cercanía al usuario). Reusa tal cual el resto de la
 * UI (skeleton, error/gating KYC, `FlatList` con `AvailableShipmentCard`,
 * pull-to-refresh/scroll infinito) — no se duplica la pantalla.
 */
export default function TransportScreen() {
  const colors = useThemeColors();
  const { offerCreated, tripId } = useLocalSearchParams<{ offerCreated?: string; tripId?: string }>();
  // Único punto que deriva el modo de `tripId` — el resto de los flags (isReady,
  // isInitialLoading, canExpandRadius, showOriginSkeleton, JSX) lo consumen a él en
  // vez de re-chequear `tripId`/`!tripId` cada uno por su cuenta.
  const isTripMode = Boolean(tripId);
  const [showOfferCreatedSuccess, setShowOfferCreatedSuccess] = useState(offerCreated === "1");
  const { origin, resolving, needsManualPick, setManualSelection } = useTransportOrigin(!isTripMode);
  const { radiusKm, setRadiusKm } = useTransportRadius();
  const { data: savedAddresses } = useAddresses(!isTripMode);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (offerCreated === "1") {
      setShowOfferCreatedSuccess(true);
    }
  }, [offerCreated]);

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
  // pudiéndose reabrir después a mano con "Cambiar" (mismo estado, `pickerOpen`).
  useEffect(() => {
    if (needsManualPick) setPickerOpen(true);
  }, [needsManualPick]);

  const isGatedByKyc = isError && error instanceof ApiError && error.code === "CARRIER_NOT_VERIFIED";
  // Filtro client-side de envíos con la ventana de retiro ya vencida — el backend
  // no los excluye (ver `isPickupWindowExpired`), en ninguno de los dos modos.
  const items = (data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => !isPickupWindowExpired(item.pickupDate, item.pickupTimeWindowEnd),
  );

  // "Listo para mostrar datos": en modo viaje depende de que el detalle del viaje ya
  // resolvió (para el header de AC2); en modo genérico, del origen (GPS/default/
  // manual) — reemplaza el `origin !== null` que antes gateaba todo el render.
  const isReady = isTripMode ? !!trip : origin !== null;

  // Si una página entera vino con todos sus ítems vencidos, el filtro de arriba
  // puede dejar `items` vacío aunque el servidor todavía tenga más páginas — sin
  // esto se mostraría el estado vacío pudiendo haber envíos vigentes más adelante.
  const shouldCascadeNextPage = isReady && !isLoading && !isError && items.length === 0 && hasNextPage;
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

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="px-5 pb-1 pt-2">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-semibold text-title text-fg">Transportar</Text>
          <Pressable
            testID="transport-my-trips-cta"
            // `as any`: ruta de MOVO-162, ver el comentario de `profile-settings-section.tsx`.
            onPress={() => router.push("/carrier/trips" as any)}
            hitSlop={8}
            className="rounded-full bg-bg-mute px-3.5 py-1.5"
          >
            <Text className="font-sans-medium text-[13px] text-fg">Mis viajes</Text>
          </Pressable>
        </View>
        {!isTripMode && origin ? (
          <View className="mt-1 flex-row items-center gap-1.5">
            <MapPin size={13} strokeWidth={1.8} color={colors.fg3} />
            <Text testID="transport-zone-label" className="flex-1 font-sans text-small text-fg-2" numberOfLines={1}>
              Envíos cerca de {origin.city ?? zoneLabelFromAddress(origin.address)}
            </Text>
            <Text
              testID="transport-change-location"
              onPress={() => setPickerOpen(true)}
              className="font-sans-medium text-small text-fg"
            >
              Cambiar
            </Text>
          </View>
        ) : null}
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

      {showOfferCreatedSuccess ? (
        <View className="px-5 pt-2">
          <SuccessBanner
            testID="transport-offer-created-success"
            message="¡Oferta enviada! Ya podés verla reflejada en el envío."
            onDismiss={() => setShowOfferCreatedSuccess(false)}
          />
        </View>
      ) : null}

      {!isTripMode && origin ? <RadiusPillRow radiusKm={radiusKm} onChange={setRadiusKm} /> : null}

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
      ) : isReady && items.length === 0 ? (
        <View className="items-center gap-2 px-5 py-10">
          <PackageX size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-small text-fg-2">
            {isTripMode
              ? "Ningún paquete compatible con este viaje todavía."
              : "No hay envíos disponibles en este radio."}
          </Text>
          {canExpandRadius ? (
            <Text
              testID="transport-expand-radius"
              onPress={() => setRadiusKm(TRANSPORT_RADIUS_OPTIONS_KM[currentRadiusIndex + 1])}
              className="font-sans-medium text-small text-fg"
            >
              Ampliar radio a {TRANSPORT_RADIUS_OPTIONS_KM[currentRadiusIndex + 1]} km
            </Text>
          ) : null}
        </View>
      ) : isReady ? (
        <FlatList
          testID="transport-list"
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }}
          renderItem={({ item }) => <AvailableShipmentCard shipment={item} testID={`transport-card-${item.id}`} />}
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
    </SafeAreaView>
  );
}
