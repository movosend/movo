import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router, useFocusEffect, useIsFocused, useLocalSearchParams, type Href } from "expo-router";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  Clock,
  CreditCard,
  Package,
  QrCode,
  Truck,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AcceptSuccessModal } from "../../../components/shipments/accept-success-modal";
import {
  CarrierCancellationCompensation,
  SenderCancelledPayment,
} from "../../../components/shipments/cancelled-payment-card";
import { HighDemandBadge, HighDemandHelp } from "../../../components/shipments/high-demand-badge";
import { FundsStatus } from "../../../components/shipments/funds-status";
import { EvidencePhotosSection } from "../../../components/shipments/evidence-photos-section";
import { RouteTrackingChatCard } from "../../../components/shipments/route-tracking-chat-card";
import { OffersBanner } from "../../../components/shipments/offers-banner";
import { PackageCard, PackageSummaryCard } from "../../../components/shipments/package-card";
import { PaymentBreakdown } from "../../../components/shipments/payment-breakdown";
import { RatingSheet, type RatingTarget } from "../../../components/shipments/rating-sheet";
import { ReceiverActionsBar } from "../../../components/shipments/receiver-actions-bar";
import { RejectedReceiverBanner } from "../../../components/shipments/rejected-receiver-banner";
import { ReceiverTransferPendingBanner } from "../../../components/shipments/receiver-transfer-pending-banner";
import { ReceiverTransferSection } from "../../../components/shipments/receiver-transfer-section";
import { TransferredByYouBanner } from "../../../components/shipments/transferred-by-you-banner";
import { CarrierActionsBar } from "../../../components/shipments/carrier-actions-bar";
import { SenderActionsBar } from "../../../components/shipments/sender-actions-bar";
import { ShipmentDetailBodySkeleton } from "../../../components/shipments/shipment-detail-skeleton";
import { SkeletonBlock } from "../../../components/ui/skeleton-block";
import { ShipmentPartiesCard } from "../../../components/shipments/shipment-parties-card";
import { ShipmentRatingsCard } from "../../../components/shipments/shipment-ratings-card";
import { ShipmentStatusBadge } from "../../../components/shipments/status-badge";
import { TimelineSection } from "../../../components/shipments/timeline-section";
import { RouteMapCard } from "../../../components/send/route-map-card";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { GridPattern } from "../../../components/ui/grid-pattern";
import { DebtDiscount } from "../../../components/payments/debt-discount";
import { SuccessBanner } from "../../../components/ui/success-banner";
import { useAuthStore } from "../../../src/store/auth-store";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useDeadlineExpired } from "../../../src/hooks/use-deadline-expired";
import { usePublicProfile } from "../../../src/hooks/use-profile";
import { useShipmentRatings } from "../../../src/hooks/use-ratings";
import { useShipment, useShipmentPhotos } from "../../../src/hooks/use-shipments";
import { useShipmentSettlement } from "../../../src/hooks/use-shipment-settlement";
import { carrierCompensationView } from "../../../src/lib/cancellation-format";
import { useShipmentHold } from "../../../src/hooks/use-shipment-hold";
import {
  TRANSIT_DELAYED_INFO_TEXT,
  activeShipmentDisplayCode,
  isTransitDelayed,
} from "../../../src/lib/active-shipment-format";
import { carrierReceivedBeforeDebtArs } from "../../../src/lib/commission-config";
import { chatAvailability } from "../../../src/lib/chat-format";
import {
  FULFILLED_SHIPMENT_STATUSES,
  canCancelShipment,
  canCarrierWithdraw,
  formatPickupDateLabel,
  formatPriceArs,
  formatShipmentPrice,
  formatTimeHHMM,
  liveTrackingAvailability,
  liveTrackingPendingPollInterval,
  receiverConfirmationStatus,
  isFundingWindowOpen,
  shipmentDetailCta,
  type ShipmentDetailRole,
} from "../../../src/lib/shipment-format";
import { fundingProcessingPollInterval, fundsStatusVariant } from "../../../src/lib/funds-status-format";

type DetailTab = "detalle" | "timeline";

const SHORT_DAY_FORMATTER = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

/** "Receptor desde el 10 oct · antes, vos" (MOVO-275): la fila del receptor nuevo vista por
 * quien le pasó la recepción. */
function formerReceiverNote(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Receptor · antes, vos";
  return `Receptor desde el ${SHORT_DAY_FORMATTER.format(date).replace(".", "")} · antes, vos`;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">{children}</Text>;
}

function ShipmentDetailError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const message =
    error instanceof ApiError && error.statusCode === 403
      ? "Este envío no te pertenece."
      : error instanceof ApiError && error.statusCode === 404
        ? "Este envío no existe."
        : "No pudimos cargar este envío.";

  return (
    <View className="px-5 pt-2 gap-3">
      <ErrorBanner testID="shipment-detail-error" message={message} />
      <Pressable onPress={onRetry} className="self-start rounded-lg bg-bg-mute px-3 py-1.5">
        <Text className="font-sans-medium text-small text-fg">Reintentar</Text>
      </Pressable>
    </View>
  );
}

const TABS: [DetailTab, string][] = [
  ["detalle", "Detalles"],
  ["timeline", "Línea de tiempo"],
];

const CANCELLATION_PENALTY_POLL_MS = 15_000;

/**
 * Detalle de un envío propio (MOVO-127) con soporte para calificaciones
 * post-entrega (MOVO-153).
 */
export default function ShipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const currentUser = useAuthStore((state) => state.user);
  // MOVO-271 AC5: mientras el seguimiento espera a que arranque el recorrido, el detalle
  // se refresca solo para habilitarlo sin salir de la pantalla. Importa sobre todo para
  // el receptor, que no participa del retiro (el emisor vuelve del handshake y el
  // `useFocusEffect` de abajo ya refetchea). Sin el placeholder no hay polling. Solo con
  // foco: el detalle sigue montado en el stack cuando se abre otra pantalla encima, y
  // React Query no conoce el foco de React Navigation.
  const isFocused = useIsFocused();
  const { data: shipment, isLoading, isError, error, refetch } = useShipment(id, {
    refetchInterval: (data) => {
      if (!isFocused) return false;
      if (data?.status === ShipmentStatus.CANCELLED && data.cancellationPenaltyStatus === "pending") {
        return CANCELLATION_PENALTY_POLL_MS;
      }
      return fundingProcessingPollInterval(data) || liveTrackingPendingPollInterval(data, currentUser?.userId);
    },
  });
  const [tab, setTab] = useState<DetailTab>("detalle");
  const [isHighDemandHelpOpen, setIsHighDemandHelpOpen] = useState(false);
  const [isAcceptSuccessVisible, setIsAcceptSuccessVisible] = useState(false);

  const { data: ratings, refetch: refetchRatings } = useShipmentRatings(
    shipment && FULFILLED_SHIPMENT_STATUSES.includes(shipment.status) ? shipment.id : undefined
  );
  const [ratingTarget, setRatingTarget] = useState<RatingTarget | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const photosQuery = useShipmentPhotos(id);
  const photosQueryRef = useRef(photosQuery);
  photosQueryRef.current = photosQuery;

  // MOVO-214: el detalle del pago es de emisor y transportista, y recién existe con el envío
  // entregado (AC1-AC3). El receptor que transfirió tampoco lo ve (no es parte del cobro).
  const paymentRole =
    shipment === undefined || shipment.receiverTransfer?.viewerIsFormerReceiver === true
      ? null
      : currentUser?.userId === shipment.carrierId
        ? ("carrier" as const)
        : currentUser?.userId === shipment.senderId
          ? ("sender" as const)
          : null;
  const showPayment =
    paymentRole !== null && shipment !== undefined && FULFILLED_SHIPMENT_STATUSES.includes(shipment.status);
  // MOVO-308: en un envío cancelado, el emisor ve qué pasó con su reserva y el transportista
  // la compensación si el emisor canceló tarde (settlement `cancellation_penalty`).
  const isCancelled = shipment?.status === ShipmentStatus.CANCELLED;
  const showCancelledSenderPayment = paymentRole === "sender" && isCancelled;
  const showCancellationCompensation = paymentRole === "carrier" && isCancelled;
  const settlementQuery = useShipmentSettlement(id, {
    enabled: showPayment || showCancellationCompensation,
    pollWhileProcessingMs: isFocused ? 15_000 : false,
  });
  const refetchSettlement = settlementQuery.refetch;
  const holdQuery = useShipmentHold(id, { enabled: showCancelledSenderPayment });
  const refetchHold = holdQuery.refetch;

  useFocusEffect(
    useCallback(() => {
      void refetch();
      if (shipment && FULFILLED_SHIPMENT_STATUSES.includes(shipment.status)) {
        void refetchRatings();
      }
      if (showPayment || showCancellationCompensation) void refetchSettlement();
      if (showCancelledSenderPayment) void refetchHold();
    }, [
      refetch,
      refetchRatings,
      refetchSettlement,
      refetchHold,
      showPayment,
      showCancellationCompensation,
      showCancelledSenderPayment,
      shipment?.status,
    ])
  );

  // Las URLs de las fotos son presigned y vencen: al volver a la pantalla pasado el
  // `staleTime` se piden de nuevo en vez de mostrar imágenes rotas (AC7). Efecto aparte
  // y con el estado leído de un ref al enfocar, no de un valor reactivo: así el flip de
  // `isStale` no vuelve a disparar el refetch del detalle y las calificaciones, y no
  // pisa el fetch inicial de la primera visita.
  useFocusEffect(
    useCallback(() => {
      const photos = photosQueryRef.current;
      if (photos.isStale && photos.fetchStatus !== "fetching") {
        void photos.refetch();
      }
    }, [])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([
      refetch(),
      refetchRatings(),
      photosQueryRef.current.refetch(),
      ...(showPayment || showCancellationCompensation ? [refetchSettlement()] : []),
      ...(showCancelledSenderPayment ? [refetchHold()] : []),
    ]);
    setRefreshing(false);
  };

  const openProfile = (userId: string) => router.push(`/profile/${userId}`);

  const activeUserId = currentUser?.userId ?? "";

  const isReceiver = shipment !== undefined && currentUser?.userId === shipment.receiverId;
  // MOVO-275 (ADR-037): le pasó la recepción a otra persona y ve el envío en solo
  // lectura. No es ninguno de los tres roles, así que no tiene acciones ni CTA; como el
  // receptor, no ve el punto exacto de retiro ni el precio.
  const isFormerReceiver = shipment?.receiverTransfer?.viewerIsFormerReceiver === true;
  const completedTransfer = shipment?.receiverTransfer?.completed ?? null;
  const pendingTransfer = shipment?.receiverTransfer?.pending ?? null;
  const pendingOwnTransfer = pendingTransfer && pendingTransfer.requestedBy === activeUserId ? pendingTransfer : null;
  const seesReceiverView = isReceiver || isFormerReceiver;

  // Mismo query key que `ShipmentPartiesCard` (`usePublicProfile`, MOVO-154) — TanStack
  // Query dedupea, así que esto no dispara un segundo request cuando esa card ya trajo
  // el perfil del emisor. Solo se usa para nombrar al emisor en el sheet de rechazo
  // de `ReceiverActionsBar` (variante 2a del diseño de "Confirmación de envío").
  const { data: senderProfile } = usePublicProfile(
    isReceiver || (!!shipment?.carrierId && currentUser?.userId === shipment.carrierId) ? shipment?.senderId : undefined,
  );
  const senderFirstName = senderProfile?.fullName?.split(" ")[0];
  // MOVO-308: el sheet de cancelación y la card "Tu pago" nombran al transportista. Mismo
  // query key que `ShipmentPartiesCard`, sin request extra.
  const { data: carrierProfile } = usePublicProfile(
    paymentRole === "sender" ? (shipment?.carrierId ?? undefined) : undefined
  );
  const carrierFirstName = carrierProfile?.fullName?.split(" ")[0] ?? null;

  // Si el deadline ya venció, el receptor no puede actuar aunque el barrido todavía
  // no haya cancelado el envío — la deadline manda sobre el reloj del job (MOVO-130 AC5).
  // El hook re-renderiza al vencer, así que las acciones desaparecen solas con la
  // pantalla abierta, sin depender de un refetch.
  const isDeadlineExpired =
    useDeadlineExpired(shipment?.receiverConfirmationDeadline) && isReceiver;

  const showReceiverActions =
    isReceiver &&
    shipment?.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
    !isDeadlineExpired;

  // Banner visible al receptor cuando el plazo venció pero el status todavía no es CANCELLED
  const showExpiredBanner =
    isReceiver &&
    shipment?.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
    isDeadlineExpired;

  const isSender = shipment !== undefined && currentUser?.userId === shipment.senderId;
  const isCarrier = shipment !== undefined && currentUser?.userId === shipment.carrierId;

  // MOVO-211 AC6: el transportista cuya asignación se cayó por falta de pago llega por el push
  // "Envío liberado". Ya no es parte del envío: ve solo por qué se liberó, la ruta y el paquete,
  // sin acciones, evidencia ni datos de las partes.
  const isFormerCarrier = shipment?.funding?.viewer === "former_carrier";

  const showSenderActions =
    isSender && shipment !== undefined && canCancelShipment(shipment.status);
  // MOVO-314 AC1: el transportista puede bajarse mientras el envío no se retiró.
  const showCarrierActions =
    isCarrier && shipment !== undefined && canCarrierWithdraw(shipment.status);

  // MOVO-253 AC6: el receptor rechazó y el emisor puede elegir a otra persona.
  const showRejectedBanner = isSender && shipment?.status === ShipmentStatus.REJECTED_BY_RECEIVER;

  const role: ShipmentDetailRole | null = isSender
    ? "sender"
    : isReceiver
      ? "receiver"
      : isCarrier
        ? "carrier"
        : null;
  const detailCta = shipment
    ? shipmentDetailCta(role, shipment.status, shipment.id, {
        fundingWindowOpen: isFundingWindowOpen(shipment),
      })
    : null;
  // MOVO-211: con la card de la reserva a la vista, ella lleva el CTA de pago y la explicación de
  // los fondos pendientes; el pie no los repite (el Home sí los usa, de ahí que sigan en el helper).
  const fundingVariant = shipment !== undefined && !showPayment
    ? fundsStatusVariant(shipment.funding, shipment.status)
    : null;
  const fundingReplacesCta =
    shipment !== undefined && fundingVariant !== null && detailCta !== null &&
    ((shipment.status === ShipmentStatus.ASSIGNED_UNFUNDED && detailCta.kind === "info") ||
      ((shipment.status === ShipmentStatus.ASSIGNMENT_PENDING ||
        shipment.status === ShipmentStatus.ASSIGNED_UNFUNDED) &&
        detailCta.kind === "action" && detailCta.icon === "card" &&
        ["confirm", "unfinished", "rejected", "processing"].includes(fundingVariant)));
  const contextualCta =
    fundingReplacesCta ? null : detailCta;

  // El precio pactado (`agreedPriceArs`) es el bruto que paga el emisor; el
  // transportista ve lo que recibe aprox. después de la comisión de Movo (AC3) y del
  // estimado de MP (MOVO-225), el mismo monto que en el resto de las pantallas.
  const carrierReceivedArs =
    isCarrier && !isCancelled && shipment?.agreedPriceArs != null
      ? Math.max(0, carrierReceivedBeforeDebtArs(shipment.agreedPriceArs, shipment.carrierMpFeeArs) - (shipment.debtDiscount?.amountArs ?? 0))
      : null;
  // MOVO-285: con el fee que informó MP al reservar el pago el monto es exacto; si no, sigue siendo "aprox.".
  const carrierReceivedIsExact = shipment?.carrierMpFeeArs != null;

  // MOVO-271 AC5: emisor y receptor ven el seguimiento (o su placeholder) mientras hay
  // transportista y el envío no cerró; el transportista tiene su propio mapa de ruta.
  const liveTracking =
    shipment !== undefined && !isCarrier && shipment.carrierId
      ? liveTrackingAvailability(shipment.status)
      : null;

  // Espejo para el transportista: si su ubicación ya se comparte con emisor y receptor.
  const carrierSharing =
    shipment !== undefined && isCarrier && shipment.carrierId ? liveTrackingAvailability(shipment.status) : null;

  // MOVO-284: el chat existe desde que hay transportista (y queda legible tras la entrega); lo ven las tres partes.
  const chatBase = shipment !== undefined ? chatAvailability(shipment.status, shipment.carrierId) : null;
  // El receptor original (ADR-038) lee la conversación pero ya no escribe, aunque el envío siga en curso.
  const chatAccess = chatBase && isFormerReceiver ? "read_only" : chatBase;

  // Misma condición que decide "Precio pactado" en la card de precio: con transportista
  // asignado el precio que se ve ya no es el sugerido, así que el recargo no aplica.
  const hasAgreedPrice =
    shipment !== undefined && (shipment.agreedPriceArs !== null || shipment.carrierId !== null);

  const senderHold = holdQuery.data ?? null;
  // Con el pago a la vista, el precio de la card de abajo competiría con el monto real
  // (MOVO-214). MOVO-308: lo mismo con la reserva de un envío cancelado; y al transportista
  // de un envío cancelado ya no le corresponde el "Recibís aprox." del viaje.
  // Sin settlement `cancellation_penalty` (cancelación sin cargo) no hay card de compensación,
  // así que el transportista conserva el resto de la pantalla; mientras carga no se muestra
  // la price card para que no aparezca y desaparezca.
  const hidesCarrierPrice =
    showCancellationCompensation &&
    (settlementQuery.isLoading || carrierCompensationView(settlementQuery.data) !== null);
  const hidePriceCard =
    showPayment || (showCancelledSenderPayment && senderHold !== null) || hidesCarrierPrice;

  // MOVO-254: el badge es información para el emisor. `null` no equivale a `false`.
  const showHighDemandBadge = isSender && shipment?.highDemand === true && !hasAgreedPrice;

  const pickupDateLabel = shipment
    ? formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate
    : null;

  // Banner de ofertas: solo tiene sentido para el emisor mientras el envío sigue
  // abierto a ofertas (publicado, sin transportista todavía) — el receptor no
  // participa de la negociación de ofertas (AC1 de MOVO-144, 403 en backend).
  const showOffersBanner =
    isSender &&
    shipment !== undefined &&
    !shipment.carrierId &&
    receiverConfirmationStatus(shipment.status) === "confirmed";

  // `router.back()` (no `replace`) — esta pantalla siempre se llega empujando una
  // ruta nueva (fila de "Actividad reciente", MOVO-127), así que hay historial para
  // hacer pop; `replace` reemplazaba la entrada actual por Inicio en vez de sacarla
  // de la pila, lo que Expo Router anima como una pantalla nueva entrando en vez de
  // la actual saliendo hacia atrás. `canGoBack()` solo cubre una futura entrada
  // directa (push notification, MOVO-107 AC6 todavía sin destino real) sin historial.
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)/home");
    }
  };

  const handleRatingSuccess = () => {
    setSuccessMessage(
      ratingTarget?.existingRating
        ? "¡Calificación actualizada con éxito!"
        : "¡Calificación publicada con éxito!"
    );
    setRatingTarget(null);
    void refetchRatings();
  };

  // MOVO-168: el header (volver + título) se ve de entrada; solo lo que depende del envío
  // (rol, código, estado y el cuerpo) espera su skeleton.
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="shipment-detail-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans-semibold text-h3 text-fg">
            Detalle del envío
          </Text>
          {isLoading ? (
            <SkeletonBlock testID="shipment-detail-header-skeleton" className="mt-1 h-2.5 w-16 rounded-md" />
          ) : shipment ? (
            <View className="mt-0.5 flex-row items-center gap-1">
              {isFormerReceiver ? (
                <View testID="shipment-detail-role" className="flex-row items-center gap-0.5">
                  <ArrowLeftRight size={11} strokeWidth={2} color={colors.fg3} />
                  <Text className="font-sans text-[10px] uppercase tracking-wide text-fg-3">Transferiste ·</Text>
                </View>
              ) : null}
              {role ? (
                <View testID="shipment-detail-role" className="flex-row items-center gap-0.5">
                  {role === "sender" ? (
                    <ArrowUpRight size={11} strokeWidth={2} color={colors.fg3} />
                  ) : role === "receiver" ? (
                    <ArrowDownLeft size={11} strokeWidth={2} color={colors.fg3} />
                  ) : (
                    <Truck size={11} strokeWidth={2} color={colors.fg3} />
                  )}
                  <Text className="font-sans text-[10px] uppercase tracking-wide text-fg-3">
                    {role === "sender" ? "Enviás" : role === "receiver" ? "Recibís" : "Transportás"} ·
                  </Text>
                </View>
              ) : null}
              <Text testID="shipment-detail-code" className="font-sans text-[10px] uppercase tracking-wide text-fg-3">
                {activeShipmentDisplayCode(shipment.id)}
              </Text>
            </View>
          ) : null}
        </View>

        {isLoading ? <SkeletonBlock className="h-6 w-20 rounded-full" /> : null}
        {shipment ? (
          <ShipmentStatusBadge
            status={shipment.status}
            isReceiver={isReceiver}
            delayed={isTransitDelayed(shipment)}
            compact
            testID="shipment-detail-status-badge"
          />
        ) : null}
        {showSenderActions && shipment ? (
          <SenderActionsBar
            shipment={shipment}
            carrierFirstName={carrierFirstName}
            onRefetch={async () => (await refetch()).data?.status}
            onCancelled={setSuccessMessage}
            testID="shipment-detail-sender-actions"
          />
        ) : null}
        {showCarrierActions && shipment ? (
          <CarrierActionsBar
            shipmentId={shipment.id}
            senderFirstName={senderFirstName}
            onRefetch={() => void refetch()}
            onWithdrawn={(message) => {
              // El envío vuelve a `published` y deja de ser suyo (el detalle daría 403): se sale al
              // Inicio, que ya no lo lista en "Estoy transportando", con el aviso.
              router.dismissTo({
                pathname: "/(app)/(tabs)/home",
                params: { withdrawnNotice: message, withdrawnAt: String(Date.now()) },
              } as any);
            }}
            testID="shipment-detail-carrier-actions"
          />
        ) : null}
      </View>

      {isLoading ? (
        <ShipmentDetailBodySkeleton testID="shipment-detail-skeleton" />
      ) : isError || !shipment ? (
        <ShipmentDetailError error={error} onRetry={() => refetch()} />
      ) : (
        <View className="flex-1">
          {successMessage ? (
            <View className="px-5 pt-2 pb-1">
              <SuccessBanner
                message={successMessage}
                onDismiss={() => setSuccessMessage(null)}
                testID="shipment-detail-success-banner"
              />
            </View>
          ) : null}
          <View className="flex-row border-b border-border bg-bg px-5">
            {(["detalle", "timeline"] as const).map((t) => (
              <Pressable
                key={t}
                testID={`shipment-detail-tab-${t}`}
                onPress={() => setTab(t)}
                className={`mr-6 pb-2.5 pt-2 ${
                  tab === t ? "border-b-2 border-fg" : "border-b-2 border-transparent"
                }`}
              >
                <Text
                  className={`font-sans-medium text-small ${
                    tab === t ? "text-fg" : "text-fg-3"
                  }`}
                >
                  {t === "detalle" ? "Detalle" : "Línea de tiempo"}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === "detalle" ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerClassName="px-5 pt-4 pb-8 gap-4"
              refreshControl={
                <RefreshControl
                  testID="shipment-detail-refresh-control"
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor={colors.fg1}
                  progressViewOffset={32}
                  style={{ marginTop: 8 }}
                />
              }
            >
              {isReceiver && pendingOwnTransfer ? (
                <ReceiverTransferPendingBanner
                  transfer={pendingOwnTransfer}
                  testID="shipment-detail-receiver-transfer-pending"
                />
              ) : null}

              {isFormerReceiver && completedTransfer ? (
                <TransferredByYouBanner transfer={completedTransfer} testID="shipment-detail-transferred-banner" />
              ) : null}

              {/* Primero, para que la push de cobro (MOVO-212 AC6) aterrice sobre lo que avisa. */}
              {showPayment && paymentRole ? (
                <PaymentBreakdown
                  role={paymentRole}
                  shipment={shipment}
                  settlement={settlementQuery}
                  testID="shipment-detail-payment"
                />
              ) : null}

              {/* MOVO-211: estado de la reserva de fondos. Una vez entregado, el detalle del cobro
                  es el de `PaymentBreakdown` (MOVO-214), así que no se repite. */}
              {showPayment ? null : (
                <FundsStatus
                  shipment={shipment}
                  carrierFirstName={carrierFirstName ?? undefined}
                  testID="shipment-detail-funds"
                />
              )}

              {showCancelledSenderPayment ? (
                <SenderCancelledPayment
                  shipment={shipment}
                  hold={senderHold}
                  carrierFirstName={carrierFirstName}
                  testID="shipment-detail-cancelled-payment"
                />
              ) : null}

              {showCancellationCompensation ? (
                <CarrierCancellationCompensation
                  settlement={settlementQuery.data}
                  testID="shipment-detail-cancellation-compensation"
                />
              ) : null}

              {/* Ofertas recibidas arriba del mapa: es la acción principal del emisor
                  mientras el envío está publicado, y al pie de la pantalla no se veía. */}
              {showOffersBanner ? (
                <OffersBanner shipmentId={shipment.id} testID="shipment-detail-offers" />
              ) : null}

              <View>
                <Eyebrow>Ruta</Eyebrow>
                <RouteTrackingChatCard
                  shipmentId={shipment.id}
                  tracking={liveTracking}
                  sharing={carrierSharing}
                  chat={chatAccess}
                  status={shipment.status}
                  isFormerReceiver={isFormerReceiver}
                  testID="shipment-detail-route-card"
                  trackingTestID="shipment-detail-live-tracking"
                  chatTestID="shipment-detail-chat"
                >
                  <RouteMapCard
                    bare
                    pickup={{
                      address: shipment.pickupAddress,
                      lat: shipment.pickupLat,
                      lng: shipment.pickupLng,
                    }}
                    delivery={{
                      address: shipment.deliveryAddress,
                      lat: shipment.deliveryLat,
                      lng: shipment.deliveryLng,
                    }}
                    paused={!isFocused}
                    testID="shipment-detail-route-map"
                  />
                </RouteTrackingChatCard>
              </View>

              {showRejectedBanner ? (
                <RejectedReceiverBanner shipment={shipment} testID="shipment-detail-rejected-banner" />
              ) : null}

              {isTransitDelayed(shipment) ? (
                // MOVO-278 (ADR-045): mismo estilo que el banner de plazo vencido.
                <View
                  testID="shipment-detail-delayed-banner"
                  className="flex-row items-center gap-2 rounded-xl border border-warning-200 bg-warning-100 px-3.5 py-3"
                >
                  <Clock size={16} color="#A97714" strokeWidth={2} />
                  <Text className="flex-1 font-sans text-small text-warning-700">{TRANSIT_DELAYED_INFO_TEXT}</Text>
                </View>
              ) : null}

              {showExpiredBanner ? (
                <View
                  testID="shipment-detail-expired-banner"
                  className="flex-row items-center gap-2 rounded-xl border border-warning-200 bg-warning-100 px-3.5 py-3"
                >
                  <Clock size={16} color="#A97714" strokeWidth={2} />
                  <Text className="flex-1 font-sans text-small text-warning-700">
                    El plazo de 24 horas para aceptar o rechazar este envío ya venció.
                  </Text>
                </View>
              ) : null}

              {seesReceiverView ? (
                // El receptor no ve el precio (no paga nada): retiro y paquete comparten la fila.
                <View className="flex-row gap-3" testID="shipment-detail-pickup-package">
                  {/* Colores fijos: la card es lima en los dos temas, como la de precio. */}
                  <View
                    testID="shipment-detail-pickup"
                    className="relative flex-1 overflow-hidden rounded-[14px] bg-lime-200 px-4 py-3.5"
                  >
                    <GridPattern />
                    <Text className="mb-1 font-sans-medium text-caption uppercase text-ink-700">Retiro</Text>
                    <Text className="font-sans-semibold text-[15px] text-ink-950">{pickupDateLabel}</Text>
                    <Text className="mt-0.5 font-sans text-small text-ink-700">
                      {formatTimeHHMM(shipment.pickupTimeWindowStart)} –{" "}
                      {formatTimeHHMM(shipment.pickupTimeWindowEnd)}
                    </Text>
                  </View>
                  <PackageSummaryCard shipment={shipment} testID="shipment-detail-package" />
                </View>
              ) : (
                <>
                  {isFormerCarrier ? null : (
                  <View className="flex-row gap-3">
                    <View className="flex-1 rounded-[10px] bg-bg-mute px-3.5 py-3.5">
                      <View className="mb-1">
                        <Eyebrow>Retiro programado</Eyebrow>
                      </View>
                      <Text className="font-sans-semibold text-[13px] text-fg">{pickupDateLabel}</Text>
                      <Text className="mt-0.5 font-sans text-[12px] text-fg-2">
                        {formatTimeHHMM(shipment.pickupTimeWindowStart)} –{" "}
                        {formatTimeHHMM(shipment.pickupTimeWindowEnd)}
                      </Text>
                    </View>
                    {hidePriceCard ? null : (
                      <View className="relative flex-1 overflow-hidden rounded-[10px] bg-lime-200 px-3.5 py-3.5">
                        <GridPattern />
                        <Text className="font-sans-medium text-[11px] uppercase tracking-wider text-ink-700">
                          {carrierReceivedArs !== null
                            ? carrierReceivedIsExact ? "Recibís" : "Recibís aprox."
                            : hasAgreedPrice
                              ? "Precio pactado"
                              : "Costo aproximado"}
                        </Text>
                        <Text testID="shipment-detail-price" className="font-sans-semibold text-[20px] text-ink-950">
                          {carrierReceivedArs !== null
                            ? formatPriceArs(carrierReceivedArs)
                            : formatShipmentPrice(
                                shipment.agreedPriceArs,
                                shipment.suggestedPriceArs
                              )}
                        </Text>
                        {isSender && shipment.status === ShipmentStatus.ASSIGNED ? (
                          <Text className="font-sans text-[11px] text-ink-700">Reservado en tu tarjeta</Text>
                        ) : null}
                        {showHighDemandBadge ? (
                          <View className="mt-2">
                            <HighDemandBadge
                              compact
                              expanded={isHighDemandHelpOpen}
                              onToggle={() => setIsHighDemandHelpOpen((open) => !open)}
                              testID="shipment-detail-high-demand"
                            />
                          </View>
                        ) : null}
                      </View>
                    )}
                  </View>
                  )}

                  {showHighDemandBadge && isHighDemandHelpOpen && !hidePriceCard ? (
                    <View testID="shipment-detail-high-demand-explainer">
                      <HighDemandHelp testID="shipment-detail-high-demand-help" />
                    </View>
                  ) : null}
                  {!hidePriceCard && carrierReceivedArs !== null && shipment.agreedPriceArs != null ? <DebtDiscount beforeArs={carrierReceivedBeforeDebtArs(shipment.agreedPriceArs, shipment.carrierMpFeeArs)} amountArs={shipment.debtDiscount?.amountArs} /> : null}

                  <View>
                    <Eyebrow>Paquete</Eyebrow>
                    <PackageCard shipment={shipment} testID="shipment-detail-package" />
                  </View>
                </>
              )}

              {isFormerCarrier ? null : (
              <View>
                <Eyebrow>Participantes</Eyebrow>
                <ShipmentPartiesCard
                  testID="shipment-detail-parties"
                  rows={[
                    ...(isSender
                      ? []
                      : [
                          {
                            userId: shipment.senderId,
                            roleLabel: "Emisor",
                            onPress: () => openProfile(shipment.senderId),
                            testID: "shipment-detail-sender",
                          },
                        ]),
                    // Con el envío entregado, el transportista sigue en "Calificaciones".
                    ...(!isCarrier && shipment.carrierId && !FULFILLED_SHIPMENT_STATUSES.includes(shipment.status)
                      ? [
                          {
                            userId: shipment.carrierId,
                            roleLabel: "Transportista",
                            onPress: () => shipment.carrierId && openProfile(shipment.carrierId),
                            testID: "shipment-detail-carrier",
                          },
                        ]
                      : []),
                    ...(isReceiver
                      ? []
                      : [
                          {
                            userId: shipment.receiverId,
                            roleLabel: "Receptor",
                            // Quien le pasó la recepción ve desde cuándo recibe la otra persona
                            // (MOVO-275), no si aceptó el envío.
                            receiverConfirmation: isFormerReceiver
                              ? undefined
                              : receiverConfirmationStatus(shipment.status),
                            note:
                              isFormerReceiver && completedTransfer
                                ? formerReceiverNote(completedTransfer.resolvedAt ?? completedTransfer.createdAt)
                                : undefined,
                            highlight: isFormerReceiver,
                            onPress: () => openProfile(shipment.receiverId),
                            testID: "shipment-detail-receiver",
                          },
                        ]),
                  ]}
                />
              </View>
              )}

              {isFormerCarrier ? null : (
                <EvidencePhotosSection shipmentId={shipment.id} testID="shipment-detail-evidence" />
              )}

              {isReceiver && activeUserId ? (
                <ReceiverTransferSection
                  shipment={shipment}
                  currentUserId={activeUserId}
                  testID="shipment-detail-receiver-transfer"
                />
              ) : null}

              {/* Sección de calificaciones post-entrega (MOVO-153). El receptor que
                  transfirió no califica (MOVO-275): no participó de la entrega. */}
              {FULFILLED_SHIPMENT_STATUSES.includes(shipment.status) && !isFormerReceiver ? (
                <View>
                  <Eyebrow>Calificaciones</Eyebrow>
                  <ShipmentRatingsCard
                    shipment={shipment}
                    currentUserId={activeUserId}
                    ratings={ratings}
                    onRate={(target) => setRatingTarget(target)}
                    onViewProfile={openProfile}
                    testID="shipment-detail-ratings"
                  />
                </View>
              ) : null}
            </ScrollView>
          ) : (
            <View className="flex-1 px-5 pt-4">
              <TimelineSection
                shipmentId={shipment.id}
                parties={{
                  senderId: shipment.senderId,
                  receiverId: shipment.receiverId,
                  carrierId: shipment.carrierId,
                  formerReceiverId: completedTransfer?.requestedBy ?? null,
                  formerReceiverName: completedTransfer?.requesterName ?? null,
                }}
                testID="shipment-detail-timeline"
              />
            </View>
          )}

          {showReceiverActions && shipment ? (
            <ReceiverActionsBar
              shipmentId={shipment.id}
              receiverConfirmationDeadline={shipment.receiverConfirmationDeadline}
              shipmentCreatedAt={shipment.createdAt}
              senderFirstName={senderFirstName}
              onRefetch={() => refetch()}
              onAcceptSuccess={() => setIsAcceptSuccessVisible(true)}
              testID="shipment-detail-receiver-actions"
            />
          ) : null}

          {contextualCta?.kind === "action" ? (
            <View className="border-t border-border bg-bg px-5 pb-6 pt-3.5">
              <Pressable
                testID="shipment-detail-cta"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push(contextualCta.path as Href);
                }}
                accessibilityRole="button"
                className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-3.5 active:opacity-85"
              >
                {contextualCta.icon === "qr" ? (
                  <QrCode size={18} color="#0A0A0B" />
                ) : contextualCta.icon === "card" ? (
                  <CreditCard size={18} color="#0A0A0B" />
                ) : (
                  <Package size={18} color="#0A0A0B" />
                )}
                <Text className="font-sans-semibold text-body text-ink-950">{contextualCta.label}</Text>
              </Pressable>
            </View>
          ) : contextualCta?.kind === "info" ? (
            <View
              testID="shipment-detail-cta-info"
              className="flex-row items-center gap-2 border-t border-border bg-bg px-5 pb-6 pt-3.5"
            >
              <Clock size={16} color={colors.fg3} strokeWidth={2} />
              <Text className="flex-1 font-sans text-small text-fg-2">{contextualCta.text}</Text>
            </View>
          ) : null}

          <AcceptSuccessModal
            visible={isAcceptSuccessVisible}
            onDismiss={() => {
              setIsAcceptSuccessVisible(false);
              void refetch();
            }}
          />

          <RatingSheet
            shipmentId={shipment?.id ?? ""}
            target={ratingTarget}
            visible={!!ratingTarget}
            onClose={() => setRatingTarget(null)}
            onSuccess={handleRatingSuccess}
            testID="shipment-rating-sheet"
          />

        </View>
      )}
    </SafeAreaView>
  );
}
