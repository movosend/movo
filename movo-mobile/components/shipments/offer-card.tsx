import { AlertTriangle, Calendar, ChevronRight, MessageSquare } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { ProfileAvatar } from "../profile/profile-avatar";
import { StarRatingInput } from "../ui/star-rating-input";
import type { OfferSummary } from "../../src/api/offers-client";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatReputationScore } from "../../src/lib/profile-format";
import {
  formatPickupDateLabel,
  formatPickupWindowLabel,
  formatPriceArs,
  formatTimeHHMM,
} from "../../src/lib/shipment-format";

export interface OfferCardProps {
  offer: OfferSummary;
  onAccept: (offer: OfferSummary) => void;
  onReject: (offer: OfferSummary) => void;
  onViewProfile: (carrierId: string) => void;
  /** Fecha y ventana de retiro pedidas al publicar el envío — si la oferta propone otro
   * día u horario, la card lo avisa. Opcional: sin esto no se muestra ninguna nota. */
  requestedPickup?: {
    pickupDate: string;
    pickupTimeWindowStart: string;
    pickupTimeWindowEnd: string;
  };
  disabled?: boolean;
  /** MOVO-300 AC2: cuenta suspendida, solo "Elegir" queda deshabilitado. Rechazar no inicia nada
   * nuevo y sigue disponible; la explicación la muestra la pantalla arriba de la lista. */
  acceptDisabled?: boolean;
  testID?: string;
}

export function OfferCard({
  offer,
  onAccept,
  onReject,
  onViewProfile,
  requestedPickup,
  disabled = false,
  acceptDisabled = false,
  testID,
}: OfferCardProps) {
  const colors = useThemeColors();
  // La oferta solo guarda nombre y rating como snapshot, no la foto: se resuelve del
  // perfil público (misma cache que el resto de la app).
  const { data: carrierProfile } = usePublicProfile(offer.carrierId);
  const carrierName = offer.carrierNameAtOffer || "Transportista";
  const reputationLabel = formatReputationScore(offer.carrierRatingAtOffer);
  const formattedPrice = formatPriceArs(offer.priceOffered);

  // Fecha ofrecida: puede ser YYYY-MM-DD o ISO string
  const dateStr = offer.offeredDate.includes("T")
    ? offer.offeredDate.slice(0, 10)
    : offer.offeredDate;
  const formattedDate = formatPickupDateLabel(dateStr) ?? dateStr;

  const offeredWindowStart = formatTimeHHMM(offer.offeredPickupTimeWindowStart);
  const offeredWindowEnd = formatTimeHHMM(offer.offeredPickupTimeWindowEnd);
  const differsInDate = requestedPickup != null && dateStr !== requestedPickup.pickupDate;
  const differsInWindow =
    requestedPickup != null &&
    offeredWindowStart !== "" &&
    offeredWindowEnd !== "" &&
    (offeredWindowStart !== formatTimeHHMM(requestedPickup.pickupTimeWindowStart) ||
      offeredWindowEnd !== formatTimeHHMM(requestedPickup.pickupTimeWindowEnd));
  const differsFromRequested = differsInDate || differsInWindow;
  const requestedDateLabel = requestedPickup
    ? (formatPickupDateLabel(requestedPickup.pickupDate) ?? requestedPickup.pickupDate)
    : "";

  return (
    <View
      testID={testID ?? `offer-card-${offer.id}`}
      className="rounded-[16px] border border-border bg-bg p-4 gap-3.5"
    >
      {/* Header: Carrier Info & View Profile */}
      <Pressable
        testID={testID ? `${testID}-carrier-pressable` : `offer-card-${offer.id}-carrier-pressable`}
        onPress={() => onViewProfile(offer.carrierId)}
        className="flex-row items-center gap-3 active:opacity-75"
        accessibilityRole="button"
        accessibilityLabel={`Ver perfil de ${carrierName}`}
      >
        <ProfileAvatar fullName={carrierName} photoUrl={carrierProfile?.photoUrl ?? null} size={42} />
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text
              testID={testID ? `${testID}-carrier-name` : `offer-card-${offer.id}-carrier-name`}
              className="font-sans-semibold text-[15px] text-fg"
            >
              {carrierName}
            </Text>
            <ChevronRight size={14} color={colors.fg3} />
          </View>

          <View className="flex-row items-center gap-1.5 mt-0.5">
            <StarRatingInput score={offer.carrierRatingAtOffer ?? 0} readOnly size={12} gap={1.5} />
            <Text
              testID={testID ? `${testID}-reputation` : `offer-card-${offer.id}-reputation`}
              className="font-sans text-[12px] text-fg-3"
            >
              {reputationLabel}
            </Text>
          </View>
        </View>
      </Pressable>

      {/* Middle Row: Price & Trip Date */}
      <View className="flex-row items-center justify-between rounded-[12px] bg-bg-mute px-3.5 py-3">
        <View>
          <Text className="font-sans text-[11px] uppercase tracking-wider text-fg-3">
            Precio ofertado
          </Text>
          <Text
            testID={testID ? `${testID}-price` : `offer-card-${offer.id}-price`}
            className="font-sans-semibold text-[20px] text-fg mt-0.5"
          >
            {formattedPrice}
          </Text>
        </View>

        <View className="items-end">
          <View className="flex-row items-center gap-1.5">
            <Calendar size={13} color={colors.fg3} />
            <Text className="font-sans text-[11px] uppercase tracking-wider text-fg-3">
              Fecha de viaje
            </Text>
          </View>
          <Text
            testID={testID ? `${testID}-date` : `offer-card-${offer.id}-date`}
            className="font-sans-medium text-[13px] text-fg-2 mt-0.5"
          >
            {formattedDate}
          </Text>
        </View>
      </View>

      {/* Aviso: la oferta propone otro día u horario que el pedido al publicar */}
      {differsFromRequested && requestedPickup ? (
        <View
          testID={testID ? `${testID}-schedule-note` : `offer-card-${offer.id}-schedule-note`}
          className="flex-row items-start gap-2 rounded-[10px] border border-warning-200 bg-warning-100 px-3 py-2.5"
        >
          <AlertTriangle size={14} color="#A97714" strokeWidth={2} className="mt-0.5" />
          <Text className="flex-1 font-sans text-[12.5px] leading-[18px] text-ink-950">
            <Text className="font-sans-semibold">Otra fecha u horario que el pedido. </Text>
            Pediste {requestedDateLabel},{" "}
            {formatPickupWindowLabel(
              requestedPickup.pickupTimeWindowStart,
              requestedPickup.pickupTimeWindowEnd,
            )}
            .
            {offeredWindowStart && offeredWindowEnd
              ? ` Propone ${formattedDate}, ${formatPickupWindowLabel(offeredWindowStart, offeredWindowEnd)}.`
              : ` Propone ${formattedDate}.`}
          </Text>
        </View>
      ) : null}

      {/* Message if present */}
      {offer.message ? (
        <View
          testID={testID ? `${testID}-message` : `offer-card-${offer.id}-message`}
          className="flex-row gap-2 rounded-[10px] bg-bg-mute/60 px-3 py-2.5"
        >
          <MessageSquare size={14} color={colors.fg3} className="mt-0.5" />
          <Text className="flex-1 font-sans text-[13px] leading-4 text-fg-2">
            {offer.message}
          </Text>
        </View>
      ) : null}

      {/* Action Buttons */}
      <View className="flex-row items-center gap-2.5 pt-1">
        <Pressable
          testID={testID ? `${testID}-reject-btn` : `offer-card-${offer.id}-reject-btn`}
          onPress={() => onReject(offer)}
          disabled={disabled}
          className="h-11 flex-1 items-center justify-center rounded-[10px] border border-border bg-bg active:bg-bg-mute"
        >
          <Text className="font-sans-medium text-[14px] text-fg-2">Rechazar</Text>
        </Pressable>

        <Pressable
          testID={testID ? `${testID}-accept-btn` : `offer-card-${offer.id}-accept-btn`}
          onPress={() => onAccept(offer)}
          disabled={disabled || acceptDisabled}
          accessibilityState={{ disabled: disabled || acceptDisabled }}
          className={`h-11 flex-1 items-center justify-center rounded-[10px] ${
            acceptDisabled ? "bg-bg-mute" : "bg-lime-500 active:bg-lime-400"
          }`}
        >
          <Text
            className={`font-sans-semibold text-[14px] ${acceptDisabled ? "text-fg-3" : "text-ink-950"}`}
          >
            Elegir
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
