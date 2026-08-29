import { Calendar, ChevronRight, MessageSquare, Star } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { ProfileAvatar } from "../profile/profile-avatar";
import type { OfferSummary } from "../../src/api/offers-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatReputationScore } from "../../src/lib/profile-format";
import { formatPickupDateLabel, formatPriceArs } from "../../src/lib/shipment-format";

export interface OfferCardProps {
  offer: OfferSummary;
  onAccept: (offer: OfferSummary) => void;
  onReject: (offer: OfferSummary) => void;
  onViewProfile: (carrierId: string) => void;
  disabled?: boolean;
  testID?: string;
}

export function OfferCard({
  offer,
  onAccept,
  onReject,
  onViewProfile,
  disabled = false,
  testID,
}: OfferCardProps) {
  const colors = useThemeColors();
  const carrierName = offer.carrierNameAtOffer || "Transportista";
  const reputationLabel = formatReputationScore(offer.carrierRatingAtOffer);
  const formattedPrice = formatPriceArs(offer.priceOffered);

  // Fecha ofrecida: puede ser YYYY-MM-DD o ISO string
  const dateStr = offer.offeredDate.includes("T")
    ? offer.offeredDate.slice(0, 10)
    : offer.offeredDate;
  const formattedDate = formatPickupDateLabel(dateStr) ?? dateStr;

  return (
    <View
      testID={testID ?? `offer-card-${offer.id}`}
      className="rounded-[16px] border border-border bg-bg p-4 shadow-sm gap-3.5"
    >
      {/* Header: Carrier Info & View Profile */}
      <Pressable
        testID={testID ? `${testID}-carrier-pressable` : `offer-card-${offer.id}-carrier-pressable`}
        onPress={() => onViewProfile(offer.carrierId)}
        className="flex-row items-center gap-3 active:opacity-75"
        accessibilityRole="button"
        accessibilityLabel={`Ver perfil de ${carrierName}`}
      >
        <ProfileAvatar fullName={carrierName} photoUrl={null} size={42} />
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

          <View className="flex-row items-center gap-1 mt-0.5">
            <Star size={12} color="#F5B93A" fill="#F5B93A" />
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
          disabled={disabled}
          className="h-11 flex-1 items-center justify-center rounded-[10px] bg-lime-500 active:bg-lime-400"
        >
          <Text className="font-sans-semibold text-[14px] text-ink-950">Elegir</Text>
        </Pressable>
      </View>
    </View>
  );
}
