import { AlertCircle, Clock } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { AvatarImage } from "../ui/avatar-image";
import { SkeletonBlock } from "../ui/skeleton-block";
import { StarRatingInput } from "../ui/star-rating-input";
import type { Rating } from "../../src/api/ratings-client";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { RatingTarget } from "./rating-sheet";

export interface ShipmentRatingsCardProps {
  shipment: ShipmentSummary;
  currentUserId: string;
  ratings: Rating[] | undefined;
  isLoadingRatings?: boolean;
  onRate: (target: RatingTarget) => void;
  testID?: string;
}

export function isRatingWindowExpired(deliveredAt: string | null | undefined): boolean {
  if (!deliveredAt) return false;
  const deliveredTime = new Date(deliveredAt).getTime();
  if (isNaN(deliveredTime)) return false;
  const WINDOW_MS = 72 * 60 * 60 * 1000;
  return Date.now() - deliveredTime > WINDOW_MS;
}

export interface CounterpartyInfo {
  userId: string;
  roleLabel: string;
}

export function resolveCounterparties(
  shipment: ShipmentSummary,
  currentUserId: string
): CounterpartyInfo[] {
  const counterparties: CounterpartyInfo[] = [];

  const isSender = currentUserId === shipment.senderId;
  const isCarrier = shipment.carrierId ? currentUserId === shipment.carrierId : false;
  const isReceiver = currentUserId === shipment.receiverId;

  if (isSender) {
    // El emisor interactúa únicamente con el transportista en el retiro
    if (shipment.carrierId) {
      counterparties.push({ userId: shipment.carrierId, roleLabel: "Transportista" });
    }
  } else if (isReceiver) {
    // El receptor interactúa únicamente con el transportista en la entrega
    if (shipment.carrierId) {
      counterparties.push({ userId: shipment.carrierId, roleLabel: "Transportista" });
    }
  } else if (isCarrier) {
    // El transportista interactúa con ambas partes (retiro y entrega)
    counterparties.push({ userId: shipment.senderId, roleLabel: "Emisor" });
    counterparties.push({ userId: shipment.receiverId, roleLabel: "Receptor" });
  }

  return counterparties;
}

function CounterpartyRatingRow({
  counterparty,
  myRating,
  isExpired,
  isInDispute,
  onRate,
  testID,
}: {
  counterparty: CounterpartyInfo;
  myRating?: Rating;
  isExpired: boolean;
  isInDispute: boolean;
  onRate: (target: RatingTarget) => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const { data: profile, isLoading } = usePublicProfile(counterparty.userId);

  if (isLoading) {
    return (
      <View
        testID={testID ? `${testID}-loading` : undefined}
        className="flex-row items-center justify-between rounded-xl border border-border bg-bg p-3.5"
      >
        <View className="flex-row items-center gap-3">
          <SkeletonBlock className="h-10 w-10 rounded-full" />
          <View className="gap-1.5">
            <SkeletonBlock className="h-3.5 w-28 rounded-md" />
            <SkeletonBlock className="h-3 w-16 rounded-md" />
          </View>
        </View>
        <SkeletonBlock className="h-8 w-20 rounded-lg" />
      </View>
    );
  }

  const fullName = profile?.fullName ?? counterparty.roleLabel;
  const hasRated = !!myRating;

  const handlePress = () => {
    onRate({
      userId: counterparty.userId,
      fullName,
      roleLabel: counterparty.roleLabel,
      existingRating: myRating,
    });
  };

  return (
    <View
      testID={testID ? `${testID}-row-${counterparty.userId}` : `rating-row-${counterparty.userId}`}
      className="gap-3 rounded-2xl border border-border bg-bg p-4"
    >
      {/* User info */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3 flex-1 pr-2">
          <AvatarImage fullName={fullName} photoUrl={profile?.photoUrl ?? null} size={40} />
          <View className="flex-1">
            <Text
              testID={testID ? `${testID}-name-${counterparty.userId}` : undefined}
              className="font-sans-semibold text-[15px] text-fg"
              numberOfLines={1}
            >
              {fullName}
            </Text>
            <Text className="font-sans text-[12px] text-fg-3">
              {counterparty.roleLabel}
            </Text>
          </View>
        </View>

        {/* Action button */}
        {!hasRated && !isExpired && !isInDispute ? (
          <Pressable
            testID={testID ? `${testID}-rate-btn-${counterparty.userId}` : `rate-btn-${counterparty.userId}`}
            onPress={handlePress}
            className="rounded-xl bg-lime-500 px-3.5 py-2 active:bg-lime-400"
            accessibilityRole="button"
            accessibilityLabel={`Calificar a ${fullName}`}
          >
            <Text className="font-sans-semibold text-[13px] text-ink-950">
              Calificar
            </Text>
          </Pressable>
        ) : null}

        {hasRated && !isExpired && !isInDispute ? (
          <Pressable
            testID={testID ? `${testID}-edit-btn-${counterparty.userId}` : `edit-btn-${counterparty.userId}`}
            onPress={handlePress}
            className="rounded-xl bg-bg-mute px-3 py-1.5 active:bg-bg-mute/80"
            accessibilityRole="button"
            accessibilityLabel={`Editar mi calificación a ${fullName}`}
          >
            <Text className="font-sans-medium text-[12px] text-fg">
              Editar
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Status or Rated display */}
      {hasRated ? (
        <View
          testID={testID ? `${testID}-rating-details-${counterparty.userId}` : undefined}
          className="rounded-xl bg-bg-mute px-3 py-2.5 gap-1.5"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <StarRatingInput score={myRating.score} readOnly size={16} gap={3} />
              <Text className="font-sans-semibold text-[13px] text-fg">
                {myRating.score} de 5
              </Text>
            </View>
            <Text className="font-sans text-[11px] text-fg-3">
              Tu calificación
            </Text>
          </View>
          {myRating.comment ? (
            <Text
              testID={testID ? `${testID}-comment-${counterparty.userId}` : undefined}
              className="font-sans text-[13px] text-fg-2 italic leading-4"
            >
              "{myRating.comment}"
            </Text>
          ) : null}
        </View>
      ) : isExpired ? (
        <View className="flex-row items-center gap-1.5 pt-0.5">
          <Clock size={13} color={colors.fg3} />
          <Text className="font-sans text-[12px] text-fg-3">
            El plazo de 72 horas para calificar terminó
          </Text>
        </View>
      ) : isInDispute ? (
        <View className="flex-row items-center gap-1.5 pt-0.5">
          <AlertCircle size={13} color="#D97706" />
          <Text className="font-sans text-[12px] text-amber-700 dark:text-amber-400">
            Vas a poder calificar cuando se resuelva la disputa
          </Text>
        </View>
      ) : (
        <View className="flex-row items-center gap-1.5 pt-0.5">
          <Clock size={13} color={colors.fg3} />
          <Text className="font-sans text-[12px] text-fg-3">
            Tenés 72 hs desde la entrega para enviar tu opinión
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * Sección de calificaciones post-entrega en el detalle del envío (MOVO-153 / MOVO-22).
 * Muestra el listado de contrapartes del envío que el usuario actual puede calificar
 * o ya calificó.
 */
export function ShipmentRatingsCard({
  shipment,
  currentUserId,
  ratings,
  onRate,
  testID,
}: ShipmentRatingsCardProps) {
  const counterparties = resolveCounterparties(shipment, currentUserId);
  const isExpired = isRatingWindowExpired(shipment.deliveredAt);
  const isInDispute = shipment.status === ShipmentStatus.DISPUTED;

  if (counterparties.length === 0) return null;

  return (
    <View testID={testID ?? "shipment-ratings-card"} className="gap-3">
      {counterparties.map((counterparty) => {
        const myRating = ratings?.find(
          (r) => r.raterId === currentUserId && r.rateeId === counterparty.userId
        );
        return (
          <CounterpartyRatingRow
            key={counterparty.userId}
            counterparty={counterparty}
            myRating={myRating}
            isExpired={isExpired}
            isInDispute={isInDispute}
            onRate={onRate}
            testID={testID}
          />
        );
      })}
    </View>
  );
}
