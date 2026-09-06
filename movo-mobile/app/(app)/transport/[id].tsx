import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { getCommissionConfig } from "@movo/shared/dist/config/commission";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronDown, ChevronLeft, Clock, Route } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import type { ReceiverConfirmationStatus } from "../../../components/shipments/counterpart-card";
import { PackageCard } from "../../../components/shipments/package-card";
import { ShipmentDetailSkeleton } from "../../../components/shipments/shipment-detail-skeleton";
import { ShipmentStatusBadge } from "../../../components/shipments/status-badge";
import { RouteMapCard } from "../../../components/send/route-map-card";
import { ProfileVerifiedBadge } from "../../../components/profile/profile-verified-badge";
import { AvatarImage } from "../../../components/ui/avatar-image";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { GridPattern } from "../../../components/ui/grid-pattern";
import { SkeletonBlock } from "../../../components/ui/skeleton-block";
import { SuccessBanner } from "../../../components/ui/success-banner";
import { useMyOffers, useWithdrawOffer } from "../../../src/hooks/use-offers";
import { usePublicProfile } from "../../../src/hooks/use-profile";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import {
  useShipment,
  useShipmentRoute,
} from "../../../src/hooks/use-shipments";
import {
  formatPickupDateLabel,
  formatPriceArs,
  formatRouteDistanceKm,
  formatTimeHHMM,
  formatTripDistanceKm,
  haversineDistanceKm,
  receiverConfirmationStatus,
  shortAddressLabel,
  zoneLabelFromAddress,
} from "../../../src/lib/shipment-format";

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">
      {children}
    </Text>
  );
}

// MOVO-177 (feedback de UI): copy plano bajo el nombre para el receptor -- distinto
// del chip de `CounterpartCard` (usado en `shipments/[id].tsx`, vista emisor/
// receptor), porque acá las dos partes conviven en una sola card ("Con quién
// tratás") y un chip de color por fila competiría visualmente con el badge de
// identidad verificada de la fila del emisor.
const RECEIVER_CONFIRMATION_TEXT: Record<ReceiverConfirmationStatus, string> = {
  pending: "Todavía no confirmó si acepta el paquete",
  confirmed: "Ya aceptó recibir el paquete",
  rejected: "Rechazó recibir el paquete",
};

function reputationSuffix(profile: PublicProfile): string | undefined {
  if (profile.reputationScore === null) return undefined;
  const scoreLabel = profile.reputationScore.toFixed(1).replace(".", ",");
  return `${scoreLabel} en ${profile.ratingCount} ${profile.ratingCount === 1 ? "envío" : "envíos"}`;
}

/**
 * Una fila de la card "Con quién tratás" (MOVO-177, feedback de UI sobre el mockup):
 * avatar + nombre + rol inline, y debajo, según el rol, o la reputación (emisor,
 * `ProfileVerifiedBadge` con sufijo) o el estado de confirmación (receptor, texto
 * plano) -- nunca ambos, y nunca inventado si `profile.reputationScore` es `null`
 * (perfil sin calificaciones todavía).
 */
function PartyRow({
  userId,
  roleLabel,
  receiverConfirmation,
  testID,
}: {
  userId: string;
  roleLabel: string;
  receiverConfirmation?: ReceiverConfirmationStatus;
  testID?: string;
}) {
  const { data: profile, isLoading, isError } = usePublicProfile(userId);

  if (isLoading) {
    return (
      <View testID={testID} className="flex-row items-center gap-3 px-4 py-3.5">
        <SkeletonBlock className="h-10 w-10 rounded-full" />
        <View className="flex-1 gap-1.5">
          <SkeletonBlock className="h-3.5 w-32 rounded-md" />
          <SkeletonBlock className="h-3 w-24 rounded-md" />
        </View>
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View testID={testID} className="px-4 py-3.5">
        <Text className="font-sans text-small text-fg-3">
          No pudimos cargar este perfil.
        </Text>
      </View>
    );
  }

  return (
    <View testID={testID} className="flex-row gap-3 px-4 py-3.5">
      <AvatarImage
        fullName={profile.fullName}
        photoUrl={profile.photoUrl}
        size={40}
      />
      <View className="flex-1">
        <Text className="font-sans-semibold text-[15px] text-fg">
          {profile.fullName}{" "}
          <Text className="font-sans text-small text-fg-3">· {roleLabel}</Text>
        </Text>
        {receiverConfirmation ? (
          <Text className="mt-1 font-sans text-small text-fg-2">
            {RECEIVER_CONFIRMATION_TEXT[receiverConfirmation]}
          </Text>
        ) : profile.isVerified ? (
          <ProfileVerifiedBadge suffix={reputationSuffix(profile)} />
        ) : null}
      </View>
    </View>
  );
}

function TransportDetailError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  // A diferencia de `shipments/[id].tsx` (vista del emisor/receptor, donde un 403
  // significa "no te pertenece"), acá el caller nunca es dueño del envío — un 403 en
  // este contexto significa que dejó de estar `published` entre que se listó y se
  // tocó la card (otro transportista ya se lo llevó, o el emisor lo canceló).
  const message =
    error instanceof ApiError && error.statusCode === 403
      ? "Este envío ya no está disponible."
      : error instanceof ApiError && error.statusCode === 404
        ? "Este envío no existe."
        : "No pudimos cargar este envío.";

  return (
    <View className="px-5 pt-2">
      <ErrorBanner testID="transport-detail-error" message={message} />
      <Text
        onPress={onRetry}
        className="mt-3 font-sans-medium text-small text-fg"
      >
        Reintentar
      </Text>
    </View>
  );
}

/**
 * Detalle de un envío disponible para el transportista (MOVO-166) con la acción de
 * ofertar y retirar oferta (MOVO-149, frontend de MOVO-23).
 *
 * Muestra ruta en mapa, paquete, fotos, ventana horaria, precio sugerido, y una única
 * card "Con quién tratás" con emisor y receptor (`PartyRow`, MOVO-177) — sin datos de
 * contacto.
 *
 * Si el transportista aún no ofertó:
 * - Acción principal "Hacer una oferta" que navega a la pantalla completa de creación
 *   de oferta (`transport/[id]/offer.tsx`, MOVO-177 -- reemplaza el bottom sheet de
 *   MOVO-149).
 *
 * Si el transportista ya tiene una oferta activa:
 * - Muestra la card con los datos de su oferta.
 * - La acción principal cambia a "Retirar oferta" con confirmación.
 */
export default function TransportShipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const {
    data: shipment,
    isLoading,
    isError,
    error,
    refetch,
  } = useShipment(id);
  // `limit: 50` es el máximo que acepta el backend (`offers.schema.ts`, default 20) —
  // sin un filtro por `shipmentId` del lado del servidor, esto es lo más que se puede
  // acotar el riesgo de no encontrar una oferta pendiente existente si el transportista
  // tiene más ofertas activas que el límite de una sola página.
  const { data: myOffers } = useMyOffers({
    status: OfferStatus.PENDING,
    limit: 50,
  });
  const withdrawOffer = useWithdrawOffer(id);

  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  const myActiveOffer = myOffers?.items.find(
    (offer) => offer.shipmentId === id,
  );

  const pickupDateLabel = shipment
    ? (formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate)
    : null;
  // Si ya existe una oferta propia, "Retirás" muestra lo que esa oferta confirmó
  // (`offeredDate`/`offeredPickupTimeWindow*`), no lo que pidió originalmente el
  // emisor -- son distintos apenas el transportista propuso otro día/horario
  // (`dateMode === "other"` de `offer.tsx`). La franja queda `null` en la oferta
  // cuando el transportista aceptó la del emisor tal cual, así que cae al valor del
  // envío en ese caso.
  const effectivePickupDateLabel = myActiveOffer
    ? (formatPickupDateLabel(myActiveOffer.offeredDate) ??
      myActiveOffer.offeredDate)
    : pickupDateLabel;
  const effectivePickupTimeWindowStart =
    myActiveOffer?.offeredPickupTimeWindowStart ??
    shipment?.pickupTimeWindowStart ??
    null;
  const effectivePickupTimeWindowEnd =
    myActiveOffer?.offeredPickupTimeWindowEnd ??
    shipment?.pickupTimeWindowEnd ??
    null;
  const tripDistanceKm = shipment
    ? haversineDistanceKm(
        shipment.pickupLat,
        shipment.pickupLng,
        shipment.deliveryLat,
        shipment.deliveryLng,
      )
    : null;
  // MOVO-177 (fix de negocio, mismo bug que se corrigió en `transport/[id]/offer.tsx`):
  // `shipment.suggestedPriceArs` es BRUTO (el precio que vio el emisor al crear el
  // envío, MOVO-82) -- pasarlo tal cual a `computeOfferGrossPrice` (que espera un
  // NETO de entrada) le sumaba una segunda comisión encima y mostraba el bruto crudo
  // como si fuera "lo que te queda". La conversión correcta es la inversa: neto =
  // bruto / (1 + tasa).
  const commissionRate = getCommissionConfig().movoCommissionRate;
  const suggestedNetIfOffered = shipment
    ? Math.round((shipment.suggestedPriceArs / (1 + commissionRate)) * 100) /
      100
    : null;
  const commissionPctLabel = `${Math.round(commissionRate * 100)}%`;
  // `RouteMapCard` de abajo ya pide esta misma ruta (mismos pickup/delivery) para
  // dibujar el mapa — TanStack Query dedupea por query key, así que pedirla acá de
  // nuevo no dispara un segundo request a la Google Routes API, solo comparte la
  // cache. Con la ruta real disponible, mostramos su `distanceMeters` en vez de la
  // aproximación en línea recta; mientras carga o si falla, cae a `tripDistanceKm`.
  const { data: route } = useShipmentRoute(
    shipment ? { lat: shipment.pickupLat, lng: shipment.pickupLng } : null,
    shipment ? { lat: shipment.deliveryLat, lng: shipment.deliveryLng } : null,
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)/transport");
    }
  };

  const handleWithdraw = () => {
    if (!myActiveOffer) return;
    Alert.alert(
      "¿Retirar oferta?",
      "¿Estás seguro de que querés retirar tu oferta? Vas a poder volver a ofertar si el envío sigue disponible.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Retirar",
          style: "destructive",
          onPress: () => {
            withdrawOffer.mutate(myActiveOffer.id, {
              onSuccess: () => {
                setWithdrawSuccess(true);
              },
            });
          },
        },
      ],
    );
  };

  if (isLoading) {
    return <ShipmentDetailSkeleton testID="transport-detail-skeleton" />;
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="transport-detail-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sans-semibold text-h3 text-fg">
            Detalle del envío
          </Text>
          {shipment ? (
            <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-wide text-fg-3">
              {shipment.id.slice(0, 8)}
            </Text>
          ) : null}
        </View>
        {shipment ? <ShipmentStatusBadge status={shipment.status} /> : null}
      </View>

      {isError || !shipment ? (
        <TransportDetailError error={error} onRetry={() => refetch()} />
      ) : (
        <View className="flex-1">
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-5 px-5 pb-6 pt-4"
          >
            {withdrawSuccess ? (
              <SuccessBanner
                testID="transport-withdraw-success"
                message="Tu oferta fue retirada."
                onDismiss={() => setWithdrawSuccess(false)}
              />
            ) : null}

            {myActiveOffer ? (
              <View
                testID="transport-active-offer-card"
                className="rounded-[12px] border border-info-200 bg-info-100/50 p-4"
              >
                <View className="mb-2 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1.5">
                    <Clock size={14} color="#1F52D6" />
                    <Text className="font-sans-semibold text-small text-info-700">
                      Tu oferta activa
                    </Text>
                  </View>
                  <View className="rounded-md bg-info-200 px-2 py-0.5">
                    <Text className="font-sans-medium text-[11px] text-info-700">
                      Pendiente
                    </Text>
                  </View>
                </View>
                <View className="mt-1 gap-1.5">
                  <View className="flex-row items-baseline justify-between">
                    <Text className="font-sans text-small text-fg-2">
                      Monto total (emisor)
                    </Text>
                    <Text
                      testID="transport-active-offer-price"
                      className="font-sans-semibold text-body text-fg"
                    >
                      {formatPriceArs(myActiveOffer.priceOffered)}
                    </Text>
                  </View>
                  <View className="flex-row items-baseline justify-between">
                    <Text className="font-sans text-small text-fg-2">
                      Fecha del viaje
                    </Text>
                    <Text
                      testID="transport-active-offer-date"
                      className="font-sans-medium text-small text-fg"
                    >
                      {formatPickupDateLabel(myActiveOffer.offeredDate) ??
                        myActiveOffer.offeredDate}
                    </Text>
                  </View>
                  {myActiveOffer.message ? (
                    <View className="mt-1 border-t border-info-200/60 pt-2">
                      <Text className="font-sans text-[11px] text-fg-3">
                        Mensaje enviado:
                      </Text>
                      <Text
                        testID="transport-active-offer-message"
                        className="mt-0.5 font-sans text-small text-fg"
                      >
                        {myActiveOffer.message}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View>
              <Eyebrow>Ruta</Eyebrow>
              <RouteMapCard
                testID="transport-detail-route-map"
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
              <View className="mt-2 flex-row items-center gap-1.5">
                <Route size={13} strokeWidth={1.8} color={colors.fg3} />
                <Text
                  testID="transport-detail-trip-distance"
                  className="font-sans text-caption text-fg-3"
                >
                  {route
                    ? `${formatRouteDistanceKm(route.distanceMeters)} de viaje`
                    : `${formatTripDistanceKm(tripDistanceKm!)} de viaje (aprox.)`}
                </Text>
              </View>
            </View>

            {/* Card "chrome": siempre oscura, sin importar el tema (mismo criterio que el
                texto oscuro fijo de PrimaryButton variant="lime" — usa la escala `ink`/
                `paper`, fija, nunca los tokens semánticos `fg`/`bg` que se invierten en
                dark mode). `GridPattern` con líneas claras porque el fondo es oscuro por
                construcción, no `bg-fg` (que en dark mode es blanco). */}
            <View className="relative overflow-hidden rounded-[16px] bg-ink-950 px-5 py-5">
              <GridPattern color="#FFFFFF" opacity={0.06} />
              <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-ink-300">
                Te queda si ofertás el sugerido
              </Text>
              <View className="mt-2 flex-row items-end gap-2">
                <Text className="font-sans-semibold text-[40px] leading-[42px] text-lime-500">
                  {formatPriceArs(suggestedNetIfOffered)}
                </Text>
                <Text className="pb-1.5 font-sans text-[13px] text-ink-300">
                  neto
                </Text>
              </View>
              <Text className="mt-2.5 font-sans text-[13px] leading-[19px] text-ink-300">
                Sobre una oferta de{" "}
                <Text className="font-sans-semibold text-paper">
                  {formatPriceArs(shipment.suggestedPriceArs)}
                </Text>
                , ya descontada la comisión de Movo.
              </Text>
              <View className="mt-4 flex-row gap-2">
                <View className="flex-1 rounded-md border border-white/10 bg-white/[0.06] px-3 py-2.5">
                  <Text className="font-sans text-[11px] text-ink-400">
                    Ofertas actuales
                  </Text>
                  <Text className="mt-0.5 font-sans-semibold text-[14px] text-paper">
                    {shipment.offersSummary
                      ? `${shipment.offersSummary.count} · desde ${formatPriceArs(shipment.offersSummary.minPriceNetArs)}`
                      : "Sin ofertas todavía"}
                  </Text>
                </View>
                {tripDistanceKm && suggestedNetIfOffered !== null ? (
                  <View className="flex-1 rounded-md border border-white/10 bg-white/[0.06] px-3 py-2.5">
                    <Text className="font-sans text-[11px] text-ink-400">
                      $ por km
                    </Text>
                    <Text className="mt-0.5 font-sans-semibold text-[14px] text-paper">
                      {formatPriceArs(
                        Math.round(suggestedNetIfOffered / tripDistanceKm),
                      )}
                      /km
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View>
              <Eyebrow>Recorrido</Eyebrow>
              <View className="rounded-[14px] border border-border px-4 py-5">
                {/* Dos filas independientes (cada ícono alinea con su propio bloque de
                    texto, no con el de la otra parada) — pero el espacio ENTRE ellas es
                    `pb-5` del bloque de texto de "Retirás", no un gap del contenedor. Al
                    ser padding (no margin) suma al alto renderizado de esa columna, así
                    que la fila entera (y por `alignItems: stretch`, también su columna de
                    ícono) se estira exactamente esos 20px de más — la línea punteada
                    (`flex-1`) los rellena y termina justo donde arranca la fila de
                    "Entregás", sin ningún hueco. */}
                <View className="flex-row gap-4">
                  <View className="items-center" style={{ width: 11 }}>
                    <View className="h-[11px] w-[11px] rounded-[3px] bg-fg" />
                    <View className="mt-1.5 w-0 flex-1 border-l border-dashed border-border-strong" />
                  </View>
                  <View className="flex-1 gap-1 pb-5">
                    <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
                      Retirás
                    </Text>
                    <Text className="font-sans-semibold text-[15px] text-fg">
                      {shortAddressLabel(shipment.pickupAddress)}
                    </Text>
                    <Text className="font-sans text-small text-fg-2">
                      {zoneLabelFromAddress(shipment.pickupAddress)}
                    </Text>
                    <View className="mt-2 flex-row items-center gap-1.5 self-start rounded-full bg-bg-mute px-3 py-2">
                      <Clock size={13} color={colors.fg1} strokeWidth={2} />
                      <Text className="font-sans-medium text-[12px] text-fg">
                        {effectivePickupDateLabel} ·{" "}
                        {formatTimeHHMM(effectivePickupTimeWindowStart)}–
                        {formatTimeHHMM(effectivePickupTimeWindowEnd)}
                      </Text>
                    </View>
                  </View>
                </View>
                <View className="flex-row gap-4">
                  <View className="items-center" style={{ width: 11 }}>
                    <ChevronDown
                      size={13}
                      color={colors.fg3}
                      strokeWidth={2.5}
                      style={{ marginBottom: -2 }}
                    />
                    <View className="h-[11px] w-[11px] rounded-full bg-fg" />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
                      Entregás
                    </Text>
                    <Text className="font-sans-semibold text-[15px] text-fg">
                      {shortAddressLabel(shipment.deliveryAddress)}
                    </Text>
                    <Text className="font-sans text-small text-fg-2">
                      {zoneLabelFromAddress(shipment.deliveryAddress)}
                    </Text>
                    <View className="mt-2 self-start rounded-full bg-bg-mute px-3 py-2">
                      <Text className="font-sans-medium text-[12px] text-fg">
                        Sin horario fijo · lo definís vos en la oferta
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            <View>
              <Eyebrow>Paquete</Eyebrow>
              <PackageCard
                shipment={shipment}
                testID="transport-detail-package"
              />
            </View>

            <View>
              <Eyebrow>Con quién tratás</Eyebrow>
              <View className="overflow-hidden rounded-[14px] border border-border">
                <PartyRow
                  userId={shipment.senderId}
                  roleLabel="emisor"
                  testID="transport-detail-sender"
                />
                <View className="h-px bg-border" />
                <PartyRow
                  userId={shipment.receiverId}
                  roleLabel="recibe"
                  receiverConfirmation={receiverConfirmationStatus(
                    shipment.status,
                  )}
                  testID="transport-detail-receiver"
                />
              </View>
            </View>
          </ScrollView>

          <View style={{ position: "relative" }}>
            {/* Sombra SOLO en el borde superior -- la barra vive fuera del
                `ScrollView`, sin esto se pierde contra el contenido al hacer scroll
                detrás. Degradado en vez de `shadowOffset`/`elevation`: `elevation`
                de Android proyecta sombra en todo el contorno de la vista (se veía
                también abajo, feedback de diseño), y esto queda arriba de la barra,
                nunca adentro de ella. */}
            <LinearGradient
              pointerEvents="none"
              colors={["transparent", colors.chromeShadow]}
              locations={[0, 1]}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: -24,
                height: 24,
                opacity: 0.5,
              }}
            />
            <View className="border-t border-border bg-bg px-5 pb-6 pt-3.5">
              {myActiveOffer ? (
                <Pressable
                  testID="transport-withdraw-offer-cta"
                  onPress={handleWithdraw}
                  disabled={withdrawOffer.isPending}
                  className="w-full flex-row items-center justify-center gap-2 rounded-lg border border-danger-300 bg-danger-100 py-3.5"
                >
                  {withdrawOffer.isPending ? (
                    <ActivityIndicator color="#C22F35" />
                  ) : null}
                  <Text className="font-sans-semibold text-body text-danger-700">
                    Retirar oferta
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  testID="transport-create-offer-cta"
                  onPress={() =>
                    router.push(`/(app)/transport/${shipment.id}/offer`)
                  }
                  className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3.5"
                >
                  <Text className="font-sans-semibold text-body text-bg">
                    Hacer una oferta
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
