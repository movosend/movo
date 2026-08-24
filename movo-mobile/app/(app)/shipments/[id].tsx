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
import { ReceiverActionsBar } from "../../../components/shipments/receiver-actions-bar";
import { SenderActionsBar } from "../../../components/shipments/sender-actions-bar";
import { ShipmentDetailSkeleton } from "../../../components/shipments/shipment-detail-skeleton";
import { ShipmentStatusBadge } from "../../../components/shipments/status-badge";
import { TimelineSection } from "../../../components/shipments/timeline-section";
import { RouteMapCard } from "../../../components/send/route-map-card";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { GridPattern } from "../../../components/ui/grid-pattern";
import { useAuthStore } from "../../../src/store/auth-store";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useDeadlineExpired } from "../../../src/hooks/use-deadline-expired";
import { useShipment } from "../../../src/hooks/use-shipments";
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

function ShipmentDetailError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError && error.statusCode === 403
      ? "Este envío no te pertenece."
      : error instanceof ApiError && error.statusCode === 404
        ? "Este envío no existe."
        : "No pudimos cargar este envío.";

  return (
    <View className="px-5 pt-2">
      <ErrorBanner testID="shipment-detail-error" message={message} />
      <Text onPress={onRetry} className="mt-3 font-sans-medium text-small text-fg">
        Reintentar
      </Text>
    </View>
  );
}

const TABS: [DetailTab, string][] = [
  ["detalle", "Detalles"],
  ["timeline", "Línea de tiempo"],
];

/**
 * Detalle de un envío propio (MOVO-127) — reemplaza el placeholder mínimo de
 * MOVO-83. Referencia visual: "02 · Detalle del pedido" del proyecto de Claude
 * Design "Movo Mobile Main Views". A diferencia de la primera versión de este
 * ticket, se mantienen las tabs Detalles/Línea de tiempo del mock (la de línea de
 * tiempo ya consume el historial real de `GET /shipments/:id/events`, MOVO-128) y
 * el banner de ofertas (`OffersBanner`, siempre en estado vacío hasta MOVO-17). El
 * mapa de ruta reusa `RouteMapCard` (mismo componente animado del paso de resumen del
 * wizard de envío, MOVO-83/123) en vez de la card estática del mock. El botón de
 * cancelar del emisor (MOVO-29, `SenderActionsBar`) vive en el header, no al pie —
 * ver su propia entrada en CLAUDE.md.
 */
export default function ShipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const currentUser = useAuthStore((state) => state.user);
  const { data: shipment, isLoading, isError, error, refetch } = useShipment(id);
  const [tab, setTab] = useState<DetailTab>("detalle");
  const [isAcceptSuccessVisible, setIsAcceptSuccessVisible] = useState(false);

  const isReceiver = shipment !== undefined && currentUser?.userId === shipment.receiverId;

  // Si el deadline ya venció, el receptor no puede actuar aunque el barrido todavía
  // no haya cancelado el envío — la deadline manda sobre el reloj del job (MOVO-130 AC5).
  // El hook re-renderiza al vencer, así que las acciones desaparecen solas con la
  // pantalla abierta, sin depender de un refetch.
  const isDeadlineExpired = useDeadlineExpired(shipment?.receiverConfirmationDeadline) && isReceiver;

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
  const showSenderActions = isSender && shipment !== undefined && canCancelShipment(shipment.status);

  const pickupDateLabel = shipment ? formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate : null;
  // Banner de ofertas: solo tiene sentido mientras el envío sigue abierto a ofertas
  // (publicado, sin transportista todavía) — un envío ya asignado, cancelado, o
  // pendiente de que el receptor confirme, no debería sugerir "todavía no tenés
  // ofertas" como si pudiera recibir alguna en cualquier momento.
  const showOffersBanner =
    shipment !== undefined && !shipment.carrierId && receiverConfirmationStatus(shipment.status) === "confirmed";

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
        {shipment ? <ShipmentStatusBadge status={shipment.status} isReceiver={isReceiver} /> : null}
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

          {showExpiredBanner ? (
            <View
              testID="shipment-detail-expired-banner"
              className="mx-5 mt-3 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3"
            >
              <Text className="font-sans-semibold text-small text-danger-700">
                El plazo para confirmar este envío ya venció
              </Text>
              <Text className="mt-0.5 font-sans text-caption text-danger-600">
                No podés aceptar ni rechazar este envío. Será cancelado automáticamente en breve.
              </Text>
            </View>
          ) : null}

          {tab === "detalle" ? (
            <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-6 pt-4">
              <View>
                <Eyebrow>Ruta</Eyebrow>
                <RouteMapCard
                  testID="shipment-detail-route-map"
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
                />
              </View>

              <View className="flex-row gap-3">
                <View className="relative flex-1 overflow-hidden rounded-[10px] bg-bg-mute px-3.5 py-3.5">
                  <GridPattern />
                  <View className="mb-2 flex-row items-center gap-1.5">
                    <Clock size={14} color={colors.fg2} />
                    <Text className="font-sans text-[11px] text-fg-3">Retiro</Text>
                  </View>
                  <Text className="font-sans-semibold text-[13px] text-fg">{pickupDateLabel}</Text>
                  <Text className="mt-0.5 font-sans text-[12px] text-fg-2">
                    {formatTimeHHMM(shipment.pickupTimeWindowStart)} – {formatTimeHHMM(shipment.pickupTimeWindowEnd)}
                  </Text>
                </View>
                <View className="relative flex-1 overflow-hidden rounded-[10px] bg-lime-200 px-3.5 py-3.5">
                  <GridPattern />
                  <Text className="mb-1 font-sans text-[11px] text-ink-950/50">
                    {shipment.agreedPriceArs !== null ? "Precio acordado" : "Costo aproximado"}
                  </Text>
                  <Text className="font-sans-semibold text-[20px] text-ink-950">
                    {formatShipmentPrice(shipment.agreedPriceArs, shipment.suggestedPriceArs)}
                  </Text>
                </View>
              </View>

              <View>
                <Eyebrow>Paquete</Eyebrow>
                <PackageCard shipment={shipment} testID="shipment-detail-package" />
              </View>

              {showOffersBanner ? <OffersBanner testID="shipment-detail-offers" /> : null}

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

              {shipment.carrierId ? (
                <View>
                  <Eyebrow>Transportista</Eyebrow>
                  <CounterpartCard userId={shipment.carrierId} testID="shipment-detail-carrier" />
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
        </View>
      )}
    </SafeAreaView>
  );
}
