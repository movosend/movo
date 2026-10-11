import { computeNetFromGross } from "@movo/shared/dist/config/commission";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router, useFocusEffect, useIsFocused, useLocalSearchParams, type Href } from "expo-router";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  Clock,
  Package,
  QrCode,
  Truck,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AcceptSuccessModal } from "../../../components/shipments/accept-success-modal";
import { HighDemandBadge } from "../../../components/shipments/high-demand-badge";
import { EvidencePhotosSection } from "../../../components/shipments/evidence-photos-section";
import { LiveTrackingCard } from "../../../components/shipments/live-tracking-card";
import { OffersBanner } from "../../../components/shipments/offers-banner";
import { PackageCard } from "../../../components/shipments/package-card";
import { RatingSheet, type RatingTarget } from "../../../components/shipments/rating-sheet";
import { ReceiverActionsBar } from "../../../components/shipments/receiver-actions-bar";
import { RejectedReceiverBanner } from "../../../components/shipments/rejected-receiver-banner";
import { ReceiverTransferPendingBanner } from "../../../components/shipments/receiver-transfer-pending-banner";
import { ReceiverTransferSection } from "../../../components/shipments/receiver-transfer-section";
import { TransferredByYouBanner } from "../../../components/shipments/transferred-by-you-banner";
import { SenderActionsBar } from "../../../components/shipments/sender-actions-bar";
import { ShipmentDetailSkeleton } from "../../../components/shipments/shipment-detail-skeleton";
import { ShipmentPartiesCard } from "../../../components/shipments/shipment-parties-card";
import { ShipmentRatingsCard } from "../../../components/shipments/shipment-ratings-card";
import { ShipmentStatusBadge } from "../../../components/shipments/status-badge";
import { TimelineSection } from "../../../components/shipments/timeline-section";
import { RouteMapCard } from "../../../components/send/route-map-card";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { GridPattern } from "../../../components/ui/grid-pattern";
import { SuccessBanner } from "../../../components/ui/success-banner";
import { useAuthStore } from "../../../src/store/auth-store";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useDeadlineExpired } from "../../../src/hooks/use-deadline-expired";
import { usePublicProfile } from "../../../src/hooks/use-profile";
import { useShipmentRatings } from "../../../src/hooks/use-ratings";
import { useShipment, useShipmentPhotos } from "../../../src/hooks/use-shipments";
import { activeShipmentDisplayCode } from "../../../src/lib/active-shipment-format";
import { getClientCommissionRate } from "../../../src/lib/commission-config";
import {
  FULFILLED_SHIPMENT_STATUSES,
  canCancelShipment,
  formatPickupDateLabel,
  formatPriceArs,
  formatShipmentPrice,
  formatTimeHHMM,
  liveTrackingAvailability,
  liveTrackingPendingPollInterval,
  receiverConfirmationStatus,
  shipmentDetailCta,
  type ShipmentDetailRole,
} from "../../../src/lib/shipment-format";

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
    refetchInterval: (data) =>
      isFocused ? liveTrackingPendingPollInterval(data, currentUser?.userId) : false,
  });
  const [tab, setTab] = useState<DetailTab>("detalle");
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

  useFocusEffect(
    useCallback(() => {
      void refetch();
      if (shipment && FULFILLED_SHIPMENT_STATUSES.includes(shipment.status)) {
        void refetchRatings();
      }
    }, [refetch, refetchRatings, shipment?.status])
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
  const { data: senderProfile } = usePublicProfile(isReceiver ? shipment?.senderId : undefined);
  const senderFirstName = senderProfile?.fullName?.split(" ")[0];

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
  const showSenderActions =
    isSender && shipment !== undefined && canCancelShipment(shipment.status);

  // MOVO-253 AC6: el receptor rechazó y el emisor puede elegir a otra persona.
  const showRejectedBanner = isSender && shipment?.status === ShipmentStatus.REJECTED_BY_RECEIVER;

  const role: ShipmentDetailRole | null = isSender
    ? "sender"
    : isReceiver
      ? "receiver"
      : isCarrier
        ? "carrier"
        : null;
  const contextualCta = shipment ? shipmentDetailCta(role, shipment.status, shipment.id) : null;

  // El precio pactado (`agreedPriceArs`) es el bruto que paga el emisor; el
  // transportista ve lo que le queda después de la comisión de Movo (AC3).
  const carrierNetArs =
    isCarrier && shipment?.agreedPriceArs != null
      ? computeNetFromGross(shipment.agreedPriceArs, getClientCommissionRate())
      : null;

  // MOVO-271 AC5: emisor y receptor ven el seguimiento (o su placeholder) mientras hay
  // transportista y el envío no cerró; el transportista tiene su propio mapa de ruta.
  const liveTracking =
    shipment !== undefined && !isCarrier && shipment.carrierId
      ? liveTrackingAvailability(shipment.status)
      : null;

  // Misma condición que decide "Precio pactado" en la card de precio: con transportista
  // asignado el precio que se ve ya no es el sugerido, así que el recargo no aplica.
  const hasAgreedPrice =
    shipment !== undefined && (shipment.agreedPriceArs !== null || shipment.carrierId !== null);

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

  if (isLoading) {
    return <ShipmentDetailSkeleton testID="shipment-detail-skeleton" />;
  }

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
          <Text className="font-sans-semibold text-h3 text-fg">Detalle del envío</Text>
          {shipment ? (
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

        {shipment ? (
          <ShipmentStatusBadge status={shipment.status} isReceiver={isReceiver} />
        ) : null}
        {showSenderActions && shipment ? (
          <SenderActionsBar
            shipmentId={shipment.id}
            onRefetch={() => refetch()}
            testID="shipment-detail-sender-actions"
          />
        ) : null}
      </View>

      {isError || !shipment ? (
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

              <View>
                <Eyebrow>Ruta</Eyebrow>
                <RouteMapCard
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
              </View>

              {showRejectedBanner ? (
                <RejectedReceiverBanner shipment={shipment} testID="shipment-detail-rejected-banner" />
              ) : null}

              {liveTracking ? (
                <LiveTrackingCard
                  shipmentId={shipment.id}
                  availability={liveTracking}
                  testID="shipment-detail-live-tracking"
                />
              ) : null}

              {showExpiredBanner ? (
                <View
                  testID="shipment-detail-expired-banner"
                  className="flex-row items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3.5 py-3"
                >
                  <Clock size={16} color="#A97714" strokeWidth={2} />
                  <Text className="flex-1 font-sans text-small text-warning-800">
                    El plazo de 24 horas para aceptar o rechazar este envío ya venció.
                  </Text>
                </View>
              ) : null}

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
                {/* El precio es un acuerdo entre emisor y transportista: el receptor no
                    paga nada, así que no se le muestra y el retiro ocupa todo el ancho. */}
                {seesReceiverView ? null : (
                  <View className="relative flex-1 overflow-hidden rounded-[10px] bg-lime-200 px-3.5 py-3.5">
                    <GridPattern />
                    <Text className="font-sans-medium text-[11px] uppercase tracking-wider text-ink-700">
                      {carrierNetArs !== null
                        ? "Te queda"
                        : hasAgreedPrice
                          ? "Precio pactado"
                          : "Costo aproximado"}
                    </Text>
                    <Text testID="shipment-detail-price" className="font-sans-semibold text-[20px] text-ink-950">
                      {carrierNetArs !== null
                        ? formatPriceArs(carrierNetArs)
                        : formatShipmentPrice(
                            shipment.agreedPriceArs,
                            shipment.suggestedPriceArs
                          )}
                    </Text>
                    {showHighDemandBadge ? (
                      <View className="mt-2">
                        <HighDemandBadge testID="shipment-detail-high-demand" />
                      </View>
                    ) : null}
                  </View>
                )}
              </View>

              <View>
                <Eyebrow>Paquete</Eyebrow>
                <PackageCard shipment={shipment} testID="shipment-detail-package" />
              </View>

              <EvidencePhotosSection shipmentId={shipment.id} testID="shipment-detail-evidence" />

              {showOffersBanner ? (
                <OffersBanner shipmentId={shipment.id} testID="shipment-detail-offers" />
              ) : null}

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
