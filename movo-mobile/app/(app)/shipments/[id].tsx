import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Clock } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AcceptSuccessModal } from "../../../components/shipments/accept-success-modal";
import { CounterpartCard } from "../../../components/shipments/counterpart-card";
import { OffersBanner } from "../../../components/shipments/offers-banner";
import { PackageCard } from "../../../components/shipments/package-card";
import { RatingSheet, type RatingTarget } from "../../../components/shipments/rating-sheet";
import { ReceiverActionsBar } from "../../../components/shipments/receiver-actions-bar";
import { SenderActionsBar } from "../../../components/shipments/sender-actions-bar";
import { ShipmentDetailSkeleton } from "../../../components/shipments/shipment-detail-skeleton";
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
import { useShipmentRatings } from "../../../src/hooks/use-ratings";
import { useShipment } from "../../../src/hooks/use-shipments";
import type { Rating } from "../../../src/api/ratings-client";
import type { ShipmentSummary } from "../../../src/api/shipments-client";
import {
  canCancelShipment,
  formatPickupDateLabel,
  formatShipmentPrice,
  formatTimeHHMM,
  receiverConfirmationStatus,
} from "../../../src/lib/shipment-format";

type DetailTab = "detalle" | "timeline";

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
  const { data: shipment, isLoading, isError, error, refetch } = useShipment(id);
  const [tab, setTab] = useState<DetailTab>("detalle");
  const [isAcceptSuccessVisible, setIsAcceptSuccessVisible] = useState(false);

  const { data: ratings, refetch: refetchRatings } = useShipmentRatings(
    shipment?.status === ShipmentStatus.DELIVERED ? shipment.id : undefined
  );
  const [ratingTarget, setRatingTarget] = useState<RatingTarget | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const activeUserId =
    currentUser?.userId ?? shipment?.senderId ?? "";

  const isReceiver = shipment !== undefined && currentUser?.userId === shipment.receiverId;

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
  const showSenderActions =
    isSender && shipment !== undefined && canCancelShipment(shipment.status);

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
            <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-wide text-fg-3">
              {shipment.id.slice(0, 8)}
            </Text>
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
                  tab === t ? "border-b-2 border-primary" : "border-b-2 border-transparent"
                }`}
              >
                <Text
                  className={`font-sans-medium text-small ${
                    tab === t ? "text-primary" : "text-fg-3"
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
            >
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
                  testID="shipment-detail-route-map"
                />
              </View>

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
                <View className="relative flex-1 overflow-hidden rounded-[10px] bg-lime-200 px-3.5 py-3.5">
                  <GridPattern />
                  <Text className="font-sans-medium text-[11px] uppercase tracking-wider text-ink-700">
                    {shipment.agreedPriceArs !== null ? "Precio acordado" : "Costo aproximado"}
                  </Text>
                  <Text className="font-sans-semibold text-[20px] text-ink-950">
                    {formatShipmentPrice(
                      shipment.agreedPriceArs,
                      shipment.suggestedPriceArs
                    )}
                  </Text>
                </View>
              </View>

              <View>
                <Eyebrow>Paquete</Eyebrow>
                <PackageCard shipment={shipment} testID="shipment-detail-package" />
              </View>

              {showOffersBanner ? (
                <OffersBanner shipmentId={shipment.id} testID="shipment-detail-offers" />
              ) : null}

              <View>
                <Eyebrow>{isReceiver ? "Emisor" : "Receptor"}</Eyebrow>
                <CounterpartCard
                  userId={isReceiver ? shipment.senderId : shipment.receiverId}
                  receiverConfirmation={
                    isReceiver ? undefined : receiverConfirmationStatus(shipment.status)
                  }
                  testID={isReceiver ? "shipment-detail-sender" : "shipment-detail-receiver"}
                />
              </View>

              {shipment.carrierId && shipment.status !== ShipmentStatus.DELIVERED ? (
                <View>
                  <Eyebrow>Transportista</Eyebrow>
                  <CounterpartCard
                    userId={shipment.carrierId}
                    testID="shipment-detail-carrier"
                  />
                </View>
              ) : null}

              {/* Sección de calificaciones post-entrega (MOVO-153) */}
              {shipment.status === ShipmentStatus.DELIVERED ? (
                <View>
                  <Eyebrow>Calificaciones</Eyebrow>
                  <ShipmentRatingsCard
                    shipment={shipment}
                    currentUserId={activeUserId}
                    ratings={ratings}
                    onRate={(target) => setRatingTarget(target)}
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
                }}
                testID="shipment-detail-timeline"
              />
            </View>
          )}

          {showReceiverActions && shipment ? (
            <ReceiverActionsBar
              shipmentId={shipment.id}
              receiverConfirmationDeadline={shipment.receiverConfirmationDeadline}
              onRefetch={() => refetch()}
              onAcceptSuccess={() => setIsAcceptSuccessVisible(true)}
              testID="shipment-detail-receiver-actions"
            />
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
