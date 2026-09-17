import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { MenuView } from "@react-native-menu/menu";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Hourglass,
  MoreVertical,
  ShieldCheck,
} from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { GridPattern } from "../../../../components/ui/grid-pattern";
import { NumericKeypad } from "../../../../components/ui/numeric-keypad";
import { SuccessBanner } from "../../../../components/ui/success-banner";
import { useOfferDetail, useUpdateOffer, useWithdrawOffer } from "../../../../src/hooks/use-offers";
import { useSheetAnimation } from "../../../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import {
  getClientCommissionRate,
  getClientMpTransactionFeeRate,
} from "../../../../src/lib/commission-config";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import {
  formatEventTimestamp,
  formatPickupDateLabel,
  formatPickupWindowLabel,
  formatPriceArs,
  formatTimeHHMM,
  shortAddressLabel,
} from "../../../../src/lib/shipment-format";
import {
  formatSentAgo,
  formatViewedBySender,
  offerPickupMatchesRequest,
  offerStatusBannerCopy,
  offerStatusLabel,
  ordinalLabel,
} from "../../../../src/lib/offer-format";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const BANNER_TONE_STYLES: Record<
  "neutral" | "positive" | "negative",
  { bg: string; border: string; iconBg: string; titleColor: string }
> = {
  neutral: {
    bg: "bg-bg-mute",
    border: "border-border",
    iconBg: "bg-bg-mute",
    titleColor: "text-fg",
  },
  positive: {
    bg: "bg-lime-100",
    border: "border-lime-500/60",
    iconBg: "bg-lime-500",
    titleColor: "text-fg",
  },
  negative: {
    bg: "bg-danger-100",
    border: "border-danger-300",
    iconBg: "bg-danger-200",
    titleColor: "text-fg",
  },
};

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2.5 font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
      {children}
    </Text>
  );
}

/**
 * Pantalla de detalle de una oferta propia del transportista (MOVO-182), fiel al
 * bloque `isDetail` del mockup de Claude Design "Transportista - Mis Ofertas.dc.html"
 * -- banner de estado, card de dinero, ranking competitivo, desglose, itinerario,
 * snapshot del emisor, historial, y acciones condicionadas al estado efectivo.
 *
 * Dos puntos de entrada conectados: la card "Tu oferta activa" de
 * `transport/[id].tsx`, y cada fila de "Todas tus ofertas" en el bridge "Mis
 * ofertas" (`carrier/offers/index.tsx`, MOVO-183) -- el listado completo con
 * ranking/reparto del ticket original (MOVO-151) sigue sin construirse, pero ya
 * hay un camino real hasta acá desde los dos lugares que el ticket pedía.
 *
 * Acciones secundarias ("Modificar fecha y horario"/"Retirar oferta") viven en un
 * menú nativo en el header (mismo `MenuView` de `SenderActionsBar`, MOVO-29) en vez
 * de botones apilados al pie -- solo "Cambiar el precio" queda como CTA primaria.
 * "Retirar oferta" abre un modal de confirmación propio (mismo patrón
 * `Modal`+`useSheetAnimation` que la cancelación de envío del emisor), no el
 * `Alert.alert` nativo que usaba antes.
 *
 * "Cuándo retirás y entregás" (antes "Lo que propusiste") no repite direcciones --
 * el header de esta pantalla y el detalle de envío que el transportista vio antes
 * de ofertar (`transport/[id].tsx`, MOVO-166) ya las muestran. En cambio, compara
 * la franja de retiro propuesta contra lo que pidió el emisor
 * (`MyOfferShipmentContext.pickupTimeWindowStart/End`, agregado en el backend para
 * esto) y lo señala explícitamente como coincidencia o diferencia -- ese
 * contraste es el dato nuevo que esta sección aporta, no la ruta.
 *
 * Mismo criterio para el "resumen del paquete" del AC1 original: se decidió NO
 * repetirlo acá -- el transportista ya lo vio completo (tipo, peso, fotos) en el
 * detalle del envío (`PackageCard`, `transport/[id].tsx`) antes de ofertar, y esta
 * pantalla es exclusivamente sobre SU oferta (plata, fechas, estado, ranking), no
 * un segundo detalle de envío. Repetirlo acá sería redundante con esa pantalla
 * anterior, igual que las direcciones de arriba.
 */
export default function OfferDetailScreen() {
  const { id: offerId } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { data: offer, isLoading, isError, error, refetch } = useOfferDetail(offerId);
  const withdrawOffer = useWithdrawOffer(offer?.shipmentId);
  const updateOffer = useUpdateOffer(offerId);

  const { colorScheme } = useColorScheme();

  const [priceSheetOpen, setPriceSheetOpen] = useState(false);
  const [draftRaw, setDraftRaw] = useState("");
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const priceSheetOpenedFor = useRef<string | null>(null);

  const { isMounted: isPriceSheetMounted, backdropStyle, sheetStyle } =
    useSheetAnimation(priceSheetOpen);
  const {
    isMounted: isWithdrawModalMounted,
    backdropStyle: withdrawBackdropStyle,
    sheetStyle: withdrawSheetStyle,
  } = useSheetAnimation(withdrawModalOpen);

  const commissionRate = getClientCommissionRate();
  const mpFeeRate = getClientMpTransactionFeeRate();

  const draftAmount = parseInt(draftRaw || "0", 10) || 0;
  const draftNetArs =
    Math.round((draftAmount / (1 + commissionRate)) * 100) / 100;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)/transport");
    }
  };

  const openPriceSheet = () => {
    if (!offer) return;
    if (priceSheetOpenedFor.current !== offer.id) {
      priceSheetOpenedFor.current = offer.id;
      setDraftRaw(String(Math.round(offer.priceOffered)));
    }
    setPriceSheetOpen(true);
  };

  const handleSavePrice = () => {
    if (!offer || draftAmount <= 0) return;
    updateOffer.mutate(
      { priceOfferedArs: draftNetArs },
      {
        onSuccess: () => {
          setPriceSheetOpen(false);
          setUpdateSuccess(true);
        },
      },
    );
  };

  const handleModifyDateAndWindow = () => {
    if (!offer) return;
    router.push(
      `/(app)/transport/${offer.shipmentId}/offer?offerId=${offer.id}`,
    );
  };

  const openWithdrawModal = () => {
    setWithdrawError(null);
    setWithdrawModalOpen(true);
  };

  const handleConfirmWithdraw = () => {
    if (!offer) return;
    withdrawOffer.mutate(offer.id, {
      onSuccess: () => {
        setWithdrawModalOpen(false);
        setWithdrawSuccess(true);
      },
      onError: () => {
        setWithdrawError("No pudimos retirar la oferta. Probá de nuevo.");
      },
    });
  };

  const handleGoToShipment = () => {
    if (!offer) return;
    router.push(`/(app)/transport/${offer.shipmentId}`);
  };

  const handleSeeSimilar = () => {
    router.push("/(app)/(tabs)/transport");
  };

  if (isLoading) {
    return (
      <SafeAreaView
        className="flex-1 items-center justify-center bg-bg"
        edges={["top", "bottom"]}
      >
        <ActivityIndicator testID="offer-detail-skeleton" color={colors.fg2} />
      </SafeAreaView>
    );
  }

  if (isError || !offer) {
    const message =
      error instanceof ApiError && error.statusCode === 404
        ? "Esta oferta no existe."
        : error instanceof ApiError && error.statusCode === 403
          ? "Esta oferta no te pertenece."
          : "No pudimos cargar esta oferta.";
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        <View className="px-5 pt-2">
          <ErrorBanner testID="offer-detail-error" message={message} />
          <Text
            onPress={() => refetch()}
            className="mt-3 font-sans-medium text-small text-fg"
          >
            Reintentar
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = offer.status;
  const shipment = offer.shipment;
  const senderFirstName = offer.senderNameAtOffer?.split(" ")[0] ?? null;
  const banner = offerStatusBannerCopy(status, {
    senderFirstName,
    viewedLabel: formatViewedBySender(offer.viewedAtBySender),
  });
  const toneStyles = BANNER_TONE_STYLES[banner.tone];

  const pickupDateLabel =
    formatPickupDateLabel(offer.offeredDate) ?? offer.offeredDate;
  const hasOfferedWindow =
    !!offer.offeredPickupTimeWindowStart && !!offer.offeredPickupTimeWindowEnd;
  // Comparación contra lo que pidió el emisor (sección "Cuándo retirás y
  // entregás") -- ver el comentario de `offerPickupMatchesRequest`.
  const pickupMatches = offerPickupMatchesRequest(offer);
  const requestedPickupLabel = `${formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate} · ${formatPickupWindowLabel(shipment.pickupTimeWindowStart, shipment.pickupTimeWindowEnd)}`;
  const perKm =
    shipment.distanceKm > 0
      ? Math.round(offer.priceNetArs / shipment.distanceKm)
      : null;

  const commissionPctLabel = `${Math.round(commissionRate * 100)}%`;
  const mpFeeEstimate =
    Math.round(offer.priceNetArs * mpFeeRate * 100) / 100;

  const rank = offer.competitiveRank;

  const timeline: { label: string; when: string | null }[] = [
    {
      label: `Mandaste tu oferta de ${formatPriceArs(offer.priceOffered)}`,
      when: formatEventTimestamp(offer.createdAt),
    },
  ];
  if (offer.viewedAtBySender) {
    timeline.push({
      label: `${senderFirstName ?? "El emisor"} vio tu oferta`,
      when: formatEventTimestamp(offer.viewedAtBySender),
    });
  }
  if (offer.respondedAt) {
    timeline.push({
      label: offerStatusLabel(status),
      when: formatEventTimestamp(offer.respondedAt),
    });
  }

  const canModify = status === OfferStatus.PENDING;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 border-b border-border px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="offer-detail-back"
          onPress={handleBack}
          className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sans-semibold text-h3 text-fg">Mi oferta</Text>
          <Text
            className="mt-0.5 font-sans text-[11px] text-fg-3"
            numberOfLines={1}
          >
            {shortAddressLabel(shipment.pickupAddress)} →{" "}
            {shortAddressLabel(shipment.deliveryAddress)}
          </Text>
        </View>
        {canModify ? (
          <View
            testID="offer-detail-menu-wrapper"
            pointerEvents={withdrawOffer.isPending ? "none" : "auto"}
            style={{ opacity: withdrawOffer.isPending ? 0.5 : 1 }}
          >
            <MenuView
              testID="offer-detail-menu"
              shouldOpenOnLongPress={false}
              isAnchoredToRight
              themeVariant={colorScheme === "dark" ? "dark" : "light"}
              onOpenMenu={() =>
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              }
              onPressAction={({ nativeEvent }) => {
                if (nativeEvent.event === "modify-date") {
                  handleModifyDateAndWindow();
                } else if (nativeEvent.event === "withdraw-offer") {
                  openWithdrawModal();
                }
              }}
              actions={[
                {
                  id: "modify-date",
                  title: "Modificar fecha y horario",
                  image: Platform.select({
                    ios: "calendar",
                    android: "ic_menu_edit",
                  }),
                },
                {
                  id: "withdraw-offer",
                  title: "Retirar oferta",
                  titleColor: "#E5484D",
                  attributes: { destructive: true },
                  image: Platform.select({
                    ios: "trash",
                    android: "ic_menu_delete",
                  }),
                  imageColor: "#E5484D",
                },
              ]}
            >
              <View
                testID="offer-detail-menu-button"
                accessibilityLabel="Más acciones"
                className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
              >
                <MoreVertical size={18} color={colors.fg1} strokeWidth={2} />
              </View>
            </MenuView>
          </View>
        ) : null}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pb-8 pt-5"
      >
        {updateSuccess ? (
          <SuccessBanner
            testID="offer-detail-update-success"
            message="Tu oferta fue actualizada."
            onDismiss={() => setUpdateSuccess(false)}
          />
        ) : null}
        {withdrawSuccess ? (
          <SuccessBanner
            testID="offer-detail-withdraw-success"
            message="Tu oferta fue retirada."
            onDismiss={() => setWithdrawSuccess(false)}
          />
        ) : null}

        {/* Banner de estado (AC1) */}
        <View
          testID="offer-detail-status-banner"
          className={`flex-row items-start gap-3.5 rounded-md border p-4 ${toneStyles.bg} ${toneStyles.border}`}
        >
          <View
            className={`h-10 w-10 items-center justify-center rounded-full ${toneStyles.iconBg}`}
          >
            {status === OfferStatus.PENDING ? (
              <Hourglass size={17} color={colors.fg2} strokeWidth={1.8} />
            ) : (
              <ShieldCheck size={17} color={colors.fg1} strokeWidth={2} />
            )}
          </View>
          <View className="flex-1 justify-center">
            <Text
              testID="offer-detail-status-title"
              className={`font-sans-semibold text-body ${toneStyles.titleColor}`}
            >
              {banner.title}
            </Text>
            <Text className="mt-1 font-sans text-[12.5px] leading-[18px] text-fg-2">
              {banner.subtitle}
            </Text>
          </View>
        </View>

        {/* Card de dinero */}
        <View className="relative overflow-hidden rounded-[16px] bg-ink-950 px-5 py-5">
          <GridPattern color="#FFFFFF" opacity={0.06} />
          <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-ink-300">
            {status === OfferStatus.ACCEPTED ? "Cobraste" : "Te queda"}
          </Text>
          <View className="mt-1 flex-row items-end gap-2">
            <Text
              testID="offer-detail-net-amount"
              className="font-sans-semibold text-[42px] leading-[44px] text-lime-500"
            >
              {formatPriceArs(offer.priceNetArs)}
            </Text>
            <Text className="pb-1.5 font-sans text-[13px] text-ink-300">
              de {formatPriceArs(offer.priceOffered)}
            </Text>
          </View>
          <View className="mt-3.5 flex-row gap-2">
            <View className="flex-1 rounded-md border border-white/10 bg-white/[0.06] px-3 py-2.5">
              <Text className="font-sans text-[11px] text-ink-400">$ por km</Text>
              <Text className="mt-0.5 font-sans-semibold text-[14px] text-paper">
                {perKm !== null ? `${formatPriceArs(perKm)}/km` : "—"}
              </Text>
            </View>
            <View className="flex-1 rounded-md border border-white/10 bg-white/[0.06] px-3 py-2.5">
              <Text className="font-sans text-[11px] text-ink-400">Enviada</Text>
              <Text className="mt-0.5 font-sans-semibold text-[14px] text-paper">
                {formatSentAgo(offer.createdAt)}
              </Text>
            </View>
          </View>
        </View>

        {/* Cómo venís (ranking) */}
        {rank ? (
          <View testID="offer-detail-rank-section">
            <View className="mb-2.5 flex-row items-baseline justify-between">
              <SectionLabel>Cómo venís</SectionLabel>
              <Text className="font-sans text-[12px] text-fg-3">
                {rank.total} {rank.total === 1 ? "oferta" : "ofertas"} en este envío
              </Text>
            </View>
            <View className="rounded-md border border-border p-3.5">
              <View className="flex-row items-end gap-2.5">
                <Text className="font-sans-semibold text-[30px] leading-none text-fg">
                  {ordinalLabel(rank.rank)}
                </Text>
                <Text className="pb-1 font-sans text-small text-fg-2">
                  {rank.rank === 1
                    ? "la más conveniente por ahora"
                    : `de ${rank.total} · te separan ${formatPriceArs(offer.priceNetArs - rank.lowestPriceNetArs)} del primero`}
                </Text>
              </View>
              <View className="mt-3.5 flex-row gap-1">
                {Array.from({ length: rank.total }, (_, i) => i + 1).map((position) => (
                  <View
                    key={position}
                    className="h-1.5 flex-1 rounded-full"
                    style={{
                      backgroundColor:
                        position === rank.rank
                          ? "#0A0A0B"
                          : position < rank.rank
                            ? "#C6F24A"
                            : "#E6E6EA",
                    }}
                  />
                ))}
              </View>
              <View className="mt-2 flex-row justify-between">
                <Text className="font-sans text-[11.5px] text-fg-3">
                  más barata {formatPriceArs(rank.lowestPriceNetArs)}
                </Text>
                <Text className="font-sans text-[11.5px] text-fg-3">
                  más cara {formatPriceArs(rank.highestPriceNetArs)}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Cómo se reparte */}
        <View>
          <View className="mb-2.5 flex-row items-baseline justify-between">
            <SectionLabel>Cómo se reparte</SectionLabel>
            <Text className="font-sans text-[11px] text-fg-3">
              {status === OfferStatus.PENDING
                ? "se recalcula si editás"
                : "congelado al ofertar"}
            </Text>
          </View>
          <View className="overflow-hidden rounded-md border border-border">
            <View className="flex-row items-center justify-between bg-bg-mute px-3.5 py-3.5">
              <Text className="font-sans text-small text-fg-2">El emisor paga</Text>
              <Text className="font-sans-semibold text-body text-fg">
                {formatPriceArs(offer.priceOffered)}
              </Text>
            </View>
            <View className="gap-2.5 px-3.5 py-3.5">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans text-small text-fg-3">
                  Comisión Movo ({commissionPctLabel})
                </Text>
                <Text className="font-sans text-small text-fg-3">
                  − {formatPriceArs(offer.commissionAmountArs)}
                </Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="font-sans text-small text-fg-3">
                  Procesamiento del pago (estimado)
                </Text>
                <Text className="font-sans text-small text-fg-3">
                  − {formatPriceArs(mpFeeEstimate)}
                </Text>
              </View>
            </View>
            <View
              className={`flex-row items-center justify-between px-3.5 py-3.5 ${
                status === OfferStatus.PENDING || status === OfferStatus.ACCEPTED
                  ? "bg-lime-500"
                  : "bg-bg-mute"
              }`}
            >
              <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-fg-2">
                {status === OfferStatus.ACCEPTED ? "Cobraste" : "Te queda"}
              </Text>
              <Text className="font-sans-semibold text-[26px] text-fg">
                {formatPriceArs(offer.priceNetArs)}
              </Text>
            </View>
          </View>
        </View>

        {/* Cuándo retirás y entregás -- sin direcciones (ya están en el header y en
         * la pantalla de detalle del envío que el transportista vio antes de llegar
         * acá, MOVO-166/`transport/[id].tsx`); el valor de esta sección es la
         * comparación contra lo que pidió el emisor, no repetir la ruta. */}
        <View>
          <SectionLabel>Cuándo retirás y entregás</SectionLabel>
          <View className="overflow-hidden rounded-md border border-border">
            <View className="flex-row gap-3 p-3.5">
              <View className="items-center" style={{ width: 11 }}>
                <View className="h-[11px] w-[11px] rounded-[3px] bg-fg" />
                <View className="mt-1.5 w-0 flex-1 border-l border-dashed border-border-strong" />
              </View>
              <View className="flex-1 gap-0.5 pb-4">
                <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
                  Retirás
                </Text>
                <Text className="font-sans-semibold text-[15px] text-fg">
                  {hasOfferedWindow
                    ? `${pickupDateLabel} · ${formatTimeHHMM(offer.offeredPickupTimeWindowStart)}–${formatTimeHHMM(offer.offeredPickupTimeWindowEnd)}`
                    : pickupDateLabel}
                </Text>
              </View>
            </View>
            <View className="flex-row gap-3 px-3.5 pb-3.5">
              <View className="items-center" style={{ width: 11 }}>
                <ChevronDown size={13} color={colors.fg3} strokeWidth={2.5} />
                <View className="mt-0.5 h-[11px] w-[11px] rounded-full bg-fg" />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
                  Entregás
                </Text>
                <Text className="font-sans-semibold text-[15px] text-fg">
                  {offer.estimatedDeliveryDate
                    ? `${formatPickupDateLabel(offer.estimatedDeliveryDate) ?? offer.estimatedDeliveryDate} · ${formatTimeHHMM(offer.estimatedDeliveryTimeWindowStart)}–${formatTimeHHMM(offer.estimatedDeliveryTimeWindowEnd)}`
                    : "Sin horario fijo (estimado)"}
                </Text>
              </View>
            </View>

            {/* Comparación contra lo que pidió el emisor -- el motivo de ser de esta
             * sección. `pickupMatches` sale de la sola presencia de la franja
             * propuesta (ver el comentario de `offerPickupMatchesRequest`). */}
            <View
              testID="offer-detail-pickup-comparison"
              className={`flex-row items-start gap-2 border-t border-border px-3.5 py-3 ${
                pickupMatches ? "bg-bg-mute" : "bg-warning-100"
              }`}
            >
              {pickupMatches ? (
                <CheckCircle2 size={15} color="#1F9760" strokeWidth={2.2} />
              ) : (
                <AlertTriangle size={15} color="#0A0A0B" strokeWidth={2.2} />
              )}
              <Text
                className={`flex-1 font-sans text-[12.5px] leading-[17px] ${
                  pickupMatches ? "text-fg-2" : "text-ink-950"
                }`}
              >
                {pickupMatches ? (
                  <>
                    Coincide con lo que pidió el emisor:{" "}
                    <Text className="font-sans-medium">{requestedPickupLabel}</Text>.
                  </>
                ) : (
                  <>
                    Es distinto a lo que pidió el emisor:{" "}
                    <Text className="font-sans-medium">{requestedPickupLabel}</Text>.
                  </>
                )}
              </Text>
            </View>
          </View>
        </View>

        {/* Mensaje enviado */}
        {offer.message ? (
          <View>
            <SectionLabel>El mensaje que mandaste</SectionLabel>
            <View className="rounded-md border border-border bg-bg-mute p-3.5">
              <Text className="font-sans text-body text-fg">{offer.message}</Text>
            </View>
          </View>
        ) : null}

        {/* Historial */}
        <View>
          <SectionLabel>Historial</SectionLabel>
          <View className="gap-0">
            {timeline.map((item, index) => (
              <View key={`${item.label}-${index}`} className="flex-row gap-3">
                <View className="items-center" style={{ width: 11 }}>
                  <View className="mt-1 h-[9px] w-[9px] rounded-full bg-fg" />
                  {index < timeline.length - 1 ? (
                    <View className="mt-0.5 w-px flex-1 bg-border" />
                  ) : null}
                </View>
                <View className="flex-1 pb-4">
                  <Text className="font-sans-semibold text-[13.5px] text-fg">
                    {item.label}
                  </Text>
                  {item.when ? (
                    <Text className="mt-0.5 font-sans text-[12px] text-fg-3">
                      {item.when}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Acciones (AC2/AC3/AC4/AC5/AC6) */}
      <View className="border-t border-border bg-bg px-5 pb-6 pt-3.5">
        {canModify ? (
          <Pressable
            testID="offer-detail-change-price-cta"
            onPress={openPriceSheet}
            className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3.5"
          >
            <Text className="font-sans-semibold text-body text-bg">
              Cambiar el precio
            </Text>
          </Pressable>
        ) : status === OfferStatus.ACCEPTED ? (
          <Pressable
            testID="offer-detail-go-to-shipment-cta"
            onPress={handleGoToShipment}
            className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3.5"
          >
            <Text className="font-sans-semibold text-body text-bg">Ver detalle del envío</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="offer-detail-see-similar-cta"
            onPress={handleSeeSimilar}
            className="w-full flex-row items-center justify-center gap-2 rounded-lg border border-border-strong bg-bg py-3.5"
          >
            <Text className="font-sans-semibold text-body text-fg">
              Ver envíos parecidos
            </Text>
          </Pressable>
        )}
      </View>

      {/* Hoja "Cambiar el precio" (AC3) */}
      <Modal
        visible={isPriceSheetMounted}
        animationType="none"
        transparent
        onRequestClose={() => !updateOffer.isPending && setPriceSheetOpen(false)}
        testID="offer-detail-price-modal"
      >
        <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
          <View className="flex-1">
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
              <Pressable
                testID="offer-detail-price-modal-backdrop"
                onPress={() => !updateOffer.isPending && setPriceSheetOpen(false)}
                className="flex-1 bg-black/40"
              />
            </Animated.View>
            <View className="flex-1 justify-end" pointerEvents="box-none">
              <Animated.View style={sheetStyle}>
                <SafeAreaView className="rounded-t-2xl bg-bg" edges={["bottom"]}>
                  <View className="px-4 pb-4 pt-4">
                    <View className="flex-row items-start justify-between gap-3">
                      <View>
                        <Text className="font-sans-semibold text-h3 text-fg">
                          Cambiar el precio
                        </Text>
                        <Text className="mt-0.5 font-sans text-[12.5px] text-fg-3">
                          El emisor ve la oferta actualizada al toque.
                        </Text>
                      </View>
                      <Pressable
                        testID="offer-detail-price-sheet-close"
                        onPress={() => setPriceSheetOpen(false)}
                        className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
                      >
                        <Text className="font-sans text-fg">✕</Text>
                      </Pressable>
                    </View>

                    <View className="mt-3.5 rounded-[14px] border-[1.5px] border-fg px-4 py-4">
                      <View className="flex-row items-end gap-1">
                        <Text className="pb-1 font-sans-semibold text-[30px] text-fg-3">
                          $
                        </Text>
                        <Text
                          testID="offer-detail-price-draft-amount"
                          className="font-sans-semibold text-[44px] leading-[46px] text-fg"
                        >
                          {draftAmount > 0 ? draftAmount.toLocaleString("es-AR") : "0"}
                        </Text>
                      </View>
                      <Text className="mt-2 font-sans text-[12px] text-fg-3">
                        te queda {formatPriceArs(draftNetArs)}
                      </Text>
                    </View>

                    <View className="mt-5">
                      <NumericKeypad
                        testIDPrefix="offer-detail-price-key"
                        onDigit={(d) =>
                          setDraftRaw((prev) =>
                            (prev + d).replace(/^0+(?=\d)/, "").slice(0, 7),
                          )
                        }
                        onDelete={() => setDraftRaw((prev) => prev.slice(0, -1))}
                      />
                    </View>

                    {updateOffer.isError ? (
                      <ErrorBanner
                        testID="offer-detail-price-error"
                        message={friendlyErrorMessage(
                          updateOffer.error,
                          "No pudimos actualizar el precio. Intentá de nuevo.",
                        )}
                      />
                    ) : null}

                    <Pressable
                      testID="offer-detail-price-save"
                      onPress={handleSavePrice}
                      disabled={draftAmount <= 0 || updateOffer.isPending}
                      className={`mt-3.5 w-full flex-row items-center justify-center gap-2 rounded-lg py-3.5 ${
                        draftAmount > 0 ? "bg-fg" : "bg-bg-mute"
                      }`}
                    >
                      {updateOffer.isPending ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : null}
                      <Text
                        className={`font-sans-semibold text-body ${draftAmount > 0 ? "text-bg" : "text-fg-3"}`}
                      >
                        Actualizar oferta
                      </Text>
                    </Pressable>
                  </View>
                </SafeAreaView>
              </Animated.View>
            </View>
          </View>
        </SafeAreaProvider>
      </Modal>

      {/* Hoja "Retirar oferta" */}
      <Modal
        visible={isWithdrawModalMounted}
        animationType="none"
        transparent
        onRequestClose={() =>
          !withdrawOffer.isPending && setWithdrawModalOpen(false)
        }
        testID="offer-detail-withdraw-modal"
      >
        <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
          <View className="flex-1">
            <Animated.View style={[StyleSheet.absoluteFill, withdrawBackdropStyle]}>
              <Pressable
                testID="offer-detail-withdraw-modal-backdrop"
                onPress={() =>
                  !withdrawOffer.isPending && setWithdrawModalOpen(false)
                }
                className="flex-1 bg-black/40"
              />
            </Animated.View>
            <View className="flex-1 justify-end" pointerEvents="box-none">
              <Animated.View style={withdrawSheetStyle}>
                <SafeAreaView className="rounded-t-2xl bg-bg" edges={["bottom"]}>
                  <View className="px-5 pt-5">
                    <Text className="mb-1 font-sans-semibold text-h3 text-fg">
                      ¿Retirar tu oferta?
                    </Text>
                    <Text className="mb-4 font-sans text-small text-fg-3">
                      Vas a poder volver a ofertar si el envío sigue disponible.
                    </Text>

                    {withdrawError ? (
                      <View className="mb-4">
                        <ErrorBanner
                          testID="offer-detail-withdraw-error"
                          message={withdrawError}
                        />
                      </View>
                    ) : null}

                    <View className="mt-2 flex-col gap-2.5 pb-4 pt-2">
                      <Pressable
                        testID="offer-detail-withdraw-confirm"
                        onPress={handleConfirmWithdraw}
                        disabled={withdrawOffer.isPending}
                        className={`w-full flex-row items-center justify-center gap-2 rounded-lg bg-danger-500 py-3.5 ${
                          withdrawOffer.isPending ? "opacity-70" : ""
                        }`}
                      >
                        {withdrawOffer.isPending ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : null}
                        <Text className="font-sans-semibold text-body text-white">
                          Retirar oferta
                        </Text>
                      </Pressable>

                      <Pressable
                        testID="offer-detail-withdraw-dismiss"
                        onPress={() => setWithdrawModalOpen(false)}
                        disabled={withdrawOffer.isPending}
                        className="w-full items-center justify-center py-2.5"
                      >
                        <Text className="font-sans-medium text-body text-fg-2">
                          Volver
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </SafeAreaView>
              </Animated.View>
            </View>
          </View>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}
