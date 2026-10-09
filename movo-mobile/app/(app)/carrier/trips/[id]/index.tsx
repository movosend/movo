import { ApiError } from "@movo/shared/dist/errors/api-error";
import { MenuView } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Lock, MoreVertical, Navigation, Package, Search } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { useColorScheme } from "nativewind";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "../../../../../components/trips/pressable-scale";
import { TripCancelSheet } from "../../../../../components/trips/trip-cancel-sheet";
import { TripDetailMap } from "../../../../../components/trips/trip-detail-map";
import { TripPackageRow } from "../../../../../components/trips/trip-package-row";
import { TripStatusPill } from "../../../../../components/trips/trip-status-pill";
import { ErrorBanner } from "../../../../../components/ui/error-banner";
import { SkeletonBlock } from "../../../../../components/ui/skeleton-block";
import { useCancelTrip, useStartTrip, useTrip } from "../../../../../src/hooks/use-trips";
import { useThemeColors } from "../../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../../src/lib/error-messages";
import { formatPriceArs, shortAddressLabel } from "../../../../../src/lib/shipment-format";
import { formatTripDateLong, formatTripStartErrorMessage, tripDisplayCode } from "../../../../../src/lib/trip-format";
import { requireCarrierLocation } from "../../../../../src/store/carrier-location-gate-store";
import { TripStatus, type TripWithAcceptedPackages } from "../../../../../src/api/trips-client";

const EDIT_ACTION_ID = "edit-trip";
const CANCEL_ACTION_ID = "cancel-trip";
const CANCEL_ERROR_FALLBACK = "No pudimos cancelar el viaje. Probá de nuevo.";

function Eyebrow({ children }: { children: string }) {
  return (
    <Text className="font-sans-semibold text-[11px] uppercase tracking-[0.88px] text-fg-3">{children}</Text>
  );
}

function DetailSkeleton() {
  return (
    <View testID="trip-detail-skeleton" className="gap-[18px] px-5 pt-2">
      <SkeletonBlock className="h-[200px] rounded-[10px]" />
      <SkeletonBlock className="h-6 w-24 rounded-full" />
      <SkeletonBlock className="h-[120px] rounded-[10px]" />
      <SkeletonBlock className="h-[64px] rounded-[10px]" />
    </View>
  );
}

function NoPackagesCard({ onSearch }: { onSearch: () => void }) {
  const colors = useThemeColors();
  return (
    <View className="items-center gap-2.5 rounded-[10px] border-[1.5px] border-dashed border-border-strong px-5 pb-5 pt-7">
      <View className="h-[52px] w-[52px] items-center justify-center rounded-full border border-border bg-bg">
        <Package size={24} color={colors.fg1} strokeWidth={1.75} />
      </View>
      <Text className="max-w-[240px] text-center font-sans-semibold text-[16px] text-fg">
        Todavía no tenés paquetes para este viaje
      </Text>
      <Text className="max-w-[260px] text-center font-sans text-[13px] leading-[19px] text-fg-3">
        Cuando alguien publique un envío en tu ruta, te llega un aviso.
      </Text>
      <PressableScale
        testID="trip-detail-search-empty"
        onPress={onSearch}
        className="mt-1.5 h-[46px] flex-row items-center gap-2 rounded-lg bg-lime-500 px-5"
      >
        <Search size={18} color="#0A0A0B" strokeWidth={1.75} />
        <Text className="font-sans-semibold text-[15px] text-ink-950">Buscar paquetes compatibles</Text>
      </PressableScale>
    </View>
  );
}

/**
 * Detalle de un viaje del transportista (MOVO-263), según el mockup de Claude Design: mapa
 * con la ruta, estado, recorrido, salida/vehículo y los paquetes aceptados. Las acciones
 * dependen del estado: `declared` sin paquetes edita/cancela, con paquetes queda bloqueado
 * (y ofrece iniciar), `active` solo lleva al mapa en vivo, y los terminales son de lectura.
 */
export default function TripDetailScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: trip, isLoading, isError, error, isRefetching, refetch } = useTrip(id);
  const cancelTrip = useCancelTrip();
  const startTrip = useStartTrip();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/carrier/trips" as any);
  };

  const searchPackages = (t: TripWithAcceptedPackages) =>
    router.push({ pathname: "/(app)/(tabs)/transport", params: { tripId: t.id } });

  const closeSheet = () => {
    setSheetOpen(false);
    setCancelError(null);
  };

  const handleCancel = (t: TripWithAcceptedPackages) => {
    setCancelError(null);
    cancelTrip.mutate(t.id, {
      onSuccess: () => {
        setSheetOpen(false);
        // `dismissTo`: el detalle se abre desde "Mis viajes", `replace` apilaría otra copia.
        router.dismissTo({
          pathname: "/carrier/trips",
          params: { cancelledTo: shortAddressLabel(t.destinationAddress) },
        } as any);
      },
      onError: (err) => {
        setCancelError(friendlyErrorMessage(err, CANCEL_ERROR_FALLBACK));
        // Carrera típica: se aceptó un paquete entre medio, así que se refresca el detalle.
        if (err instanceof ApiError && err.statusCode === 409) void refetch();
      },
    });
  };

  // Iniciar el viaje arranca el tracking: sin ubicación en segundo plano se cortaría apenas se
  // apague la pantalla, así que primero pasa por el gate (MOVO-279).
  const handleStart = (t: TripWithAcceptedPackages) => requireCarrierLocation(() => startTripNow(t));

  const startTripNow = async (t: TripWithAcceptedPackages) => {
    setStartError(null);
    try {
      await startTrip.mutateAsync(t.id);
    } catch (err) {
      setStartError(formatTripStartErrorMessage(err, t.departureAt));
    }
  };

  const renderHeader = (menu?: ReactNode) => (
    <View className="flex-row items-center gap-3 px-5 pt-1">
      <Pressable
        testID="trip-detail-back"
        onPress={handleBack}
        className="h-10 w-10 items-center justify-center rounded-full bg-bg-mute"
      >
        <ChevronLeft size={20} color={colors.fg1} strokeWidth={1.75} />
      </Pressable>
      <View className="gap-0.5">
        <Text className="font-sans-semibold text-[20px] tracking-[-0.4px] text-fg">Detalle de viaje</Text>
        {trip ? (
          <Text className="font-sans text-[11px] text-fg-3" style={{ fontVariant: ["tabular-nums"] }}>
            {tripDisplayCode(trip.id)}
          </Text>
        ) : null}
      </View>
      {menu ? <View className="ml-auto">{menu}</View> : null}
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
        {renderHeader()}
        <View className="mt-4">
          <DetailSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !trip) {
    const message =
      error instanceof ApiError && error.statusCode === 403
        ? "Este viaje no te pertenece."
        : error instanceof ApiError && error.statusCode === 404
          ? "Este viaje no existe."
          : "No pudimos cargar este viaje.";
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
        {renderHeader()}
        <View className="mt-4 gap-3 px-5">
          <ErrorBanner testID="trip-detail-error" message={message} />
          <Pressable
            testID="trip-detail-retry"
            onPress={() => refetch()}
            className="self-start rounded-lg bg-bg-mute px-3 py-1.5"
          >
            <Text className="font-sans-medium text-small text-fg">Reintentar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const packages = trip.packages ?? [];
  const hasPackages = trip.acceptedPackagesCount > 0;
  const isDeclared = trip.status === TripStatus.DECLARED;
  const canSearch = isDeclared;
  const canEditOrCancel = isDeclared && !hasPackages;
  const showFooter = trip.status === TripStatus.ACTIVE || (isDeclared && hasPackages);
  // Alto del footer = 12 (padding superior) + 52 (botón) + inset inferior real del dispositivo.
  const footerBottomPadding = Math.max(insets.bottom, 12);
  const total = packages.reduce((sum, p) => sum + p.agreedPriceArs, 0);

  const actionsMenu = canEditOrCancel ? (
    <View pointerEvents={cancelTrip.isPending ? "none" : "auto"} style={{ opacity: cancelTrip.isPending ? 0.5 : 1 }}>
      <MenuView
        testID="trip-detail-menu"
        shouldOpenOnLongPress={false}
        isAnchoredToRight
        themeVariant={colorScheme === "dark" ? "dark" : "light"}
        onOpenMenu={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === EDIT_ACTION_ID) {
            router.push(`/carrier/trips/${trip.id}/edit` as any);
          } else if (nativeEvent.event === CANCEL_ACTION_ID) {
            setCancelError(null);
            setSheetOpen(true);
          }
        }}
        actions={[
          {
            id: EDIT_ACTION_ID,
            title: "Editar viaje",
            image: Platform.select({ ios: "pencil", android: "ic_menu_edit" }),
            // Sin `imageColor` el ícono no se tiñe y queda invisible sobre el menú.
            imageColor: colors.fg1,
          },
          {
            id: CANCEL_ACTION_ID,
            title: "Cancelar viaje",
            titleColor: "#E5484D",
            attributes: { destructive: true },
            image: Platform.select({ ios: "trash", android: "ic_menu_delete" }),
            imageColor: "#E5484D",
          },
        ]}
      >
        <View
          testID="trip-detail-menu-button"
          accessibilityLabel="Más acciones"
          className="h-10 w-10 items-center justify-center rounded-full bg-bg-mute"
        >
          <MoreVertical size={18} color={colors.fg1} strokeWidth={2} />
        </View>
      </MenuView>
    </View>
  ) : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      {renderHeader(actionsMenu)}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: showFooter ? 12 + 52 + footerBottomPadding + 24 : insets.bottom + 40 }}
        refreshControl={
          <RefreshControl testID="trip-detail-refresh" refreshing={isRefetching} onRefresh={() => refetch()} />
        }
      >
        <View className="gap-6 px-5 pt-[18px]">
          <TripDetailMap testID="trip-detail-map" trip={trip} />

          <View className="gap-4">
            <View className="flex-row items-center gap-2">
              <TripStatusPill testID="trip-detail-status" status={trip.status} />
            </View>

            <View className="flex-row gap-3.5">
              <View className="items-center pt-[5px]">
                <View className="h-3 w-3 rounded-full border-[2.5px] border-fg" />
                <View className="my-1 min-h-[24px] w-0.5 flex-1 bg-border-strong" />
                <View
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: "#2B6BFF", shadowColor: "#CBDAFF", shadowOpacity: 1, shadowRadius: 0 }}
                />
              </View>
              <View className="flex-1 gap-4">
                <View>
                  <Text className="font-sans-semibold text-[17px] tracking-[-0.17px] text-fg" numberOfLines={1}>
                    {shortAddressLabel(trip.originAddress)}
                  </Text>
                  <Text className="mt-0.5 font-sans text-[13px] text-fg-3">{trip.originAddress}</Text>
                </View>
                <View>
                  <Text className="font-sans-semibold text-[17px] tracking-[-0.17px] text-fg" numberOfLines={1}>
                    {shortAddressLabel(trip.destinationAddress)}
                  </Text>
                  <Text className="mt-0.5 font-sans text-[13px] text-fg-3">{trip.destinationAddress}</Text>
                </View>
              </View>
            </View>

            <View className="flex-row rounded-[10px] border border-border">
              <View className="flex-1 gap-1 border-r border-border px-3.5 py-3">
                <Eyebrow>Salida</Eyebrow>
                <Text testID="trip-detail-departure" className="font-sans-medium text-[14px] leading-[19px] text-fg">
                  {formatTripDateLong(trip.departureAt)}
                </Text>
              </View>
              <View className="flex-1 gap-1 px-3.5 py-3">
                <Eyebrow>Vehículo</Eyebrow>
                <Text testID="trip-detail-vehicle" className="font-sans-medium text-[14px] leading-[19px] text-fg">
                  {trip.vehicleType}
                </Text>
              </View>
            </View>
          </View>

          {hasPackages ? (
            <View className="gap-3">
              <View className="flex-row items-baseline justify-between">
                <Text className="font-sans-semibold text-[16px] text-fg">
                  Paquetes aceptados ({trip.acceptedPackagesCount})
                </Text>
                {packages.length > 0 ? (
                  <Text testID="trip-detail-total" className="font-sans text-[13px] text-fg-3">
                    Total acordado{" "}
                    <Text className="font-sans-semibold text-fg">{formatPriceArs(total)}</Text>
                  </Text>
                ) : null}
              </View>
              <View className="gap-2">
                {packages.map((pkg) => (
                  <TripPackageRow
                    key={pkg.shipmentId}
                    testID={`trip-detail-package-${pkg.shipmentId}`}
                    pkg={pkg}
                    onPress={() => router.push(`/shipments/${pkg.shipmentId}` as any)}
                  />
                ))}
              </View>
              {canSearch ? (
                <PressableScale
                  testID="trip-detail-search-more"
                  onPress={() => searchPackages(trip)}
                  className="h-12 flex-row items-center justify-center gap-2 rounded-lg border border-border-strong"
                >
                  <Search size={18} color={colors.fg1} strokeWidth={1.75} />
                  <Text className="font-sans-medium text-[15px] text-fg">Buscar más paquetes para este viaje</Text>
                </PressableScale>
              ) : null}
              {isDeclared ? (
                <View
                  testID="trip-detail-locked-note"
                  className="flex-row gap-2.5 rounded-lg bg-bg-sub px-3.5 py-3"
                >
                  <Lock size={14} color={colors.fg3} strokeWidth={1.75} />
                  <Text className="flex-1 font-sans text-[12px] leading-[18px] text-fg-3">
                    Con paquetes aceptados no podés editar ni cancelar el viaje. Si necesitás cancelar, hacelo desde
                    cada envío.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : isDeclared ? (
            <View className="gap-3">
              <NoPackagesCard onSearch={() => searchPackages(trip)} />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {showFooter ? (
        <View className="absolute inset-x-0 bottom-0 gap-2 border-t border-border bg-bg px-5 pt-3" style={{ paddingBottom: footerBottomPadding }}>
          {startError ? <ErrorBanner testID="trip-detail-start-error" message={startError} /> : null}
          {trip.status === TripStatus.ACTIVE ? (
            <PressableScale
              testID="trip-detail-live-route"
              onPress={() => router.push({ pathname: "/route", params: { tripId: trip.id } } as any)}
              accessibilityRole="button"
              className="h-[52px] flex-row items-center justify-center gap-2.5 rounded-lg bg-fg"
            >
              <Navigation size={18} color={colors.bg} strokeWidth={1.75} />
              <Text className="font-sans-semibold text-[16px] text-bg">Ver ruta en vivo</Text>
            </PressableScale>
          ) : (
            <PressableScale
              testID="trip-detail-start"
              onPress={() => handleStart(trip)}
              disabled={startTrip.isPending}
              accessibilityRole="button"
              className="h-[52px] flex-row items-center justify-center gap-2 rounded-lg bg-lime-500"
            >
              {startTrip.isPending ? (
                <ActivityIndicator color="#0A0A0B" />
              ) : (
                <>
                  <Navigation size={18} color="#0A0A0B" strokeWidth={1.75} />
                  <Text className="font-sans-semibold text-[16px] text-ink-950">Iniciar viaje</Text>
                </>
              )}
            </PressableScale>
          )}
        </View>
      ) : null}

      {canEditOrCancel ? (
        <TripCancelSheet
          visible={sheetOpen}
          destination={shortAddressLabel(trip.destinationAddress)}
          isCancelling={cancelTrip.isPending}
          errorMessage={cancelError}
          onConfirm={() => handleCancel(trip)}
          onClose={closeSheet}
        />
      ) : null}
    </SafeAreaView>
  );
}
