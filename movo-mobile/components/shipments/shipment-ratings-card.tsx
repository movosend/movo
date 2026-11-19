import { AlertCircle, Clock } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus, type RatingRole } from "@movo/shared/dist/types/shipment";
import { AvatarImage } from "../ui/avatar-image";
import { SkeletonBlock } from "../ui/skeleton-block";
import { StarRatingInput } from "../ui/star-rating-input";
import type { Rating, RatingEligibility, ShipmentRatingEligibility } from "../../src/api/ratings-client";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { formatFundingDeadline } from "../../src/lib/funds-status-format";
import { FULFILLED_SHIPMENT_STATUSES } from "../../src/lib/shipment-format";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { RatingTarget } from "./rating-sheet";

export interface ShipmentRatingsCardProps {
  shipment: ShipmentSummary;
  currentUserId: string;
  ratings: Rating[] | undefined;
  isLoadingRatings?: boolean;
  /** A quién puede calificar el usuario, según el backend (`useRatingEligibility`). Mientras carga no se ofrece
   * calificar: tocar antes de saberlo llevaba al error del backend (ej. el receptor tras una disputa resuelta). */
  eligibility: ShipmentRatingEligibility | undefined;
  /** Error de la consulta. Solo un 404 (backend anterior al endpoint) vuelve al cálculo local: ante un timeout o un
   * 5xx el cálculo local le ofrecía calificar a quien el backend se lo rechaza, y no se ofrece. */
  eligibilityError?: unknown;
  onRate: (target: RatingTarget) => void;
  /** Abre el perfil público de la contraparte (MOVO-154) al tocar avatar/nombre —
   * acción distinta de calificar, por eso no comparte `Pressable` con el botón
   * "Calificar"/"Editar". */
  onViewProfile?: (userId: string) => void;
  /** Encabezado de la sección: va solo si hay alguna fila, así la pantalla no deja un título vacío. */
  header?: ReactNode;
  testID?: string;
}

export function isRatingWindowExpired(deliveredAt: string | null | undefined): boolean {
  if (!deliveredAt) return false;
  const deliveredTime = new Date(deliveredAt).getTime();
  if (isNaN(deliveredTime)) return false;
  const WINDOW_MS = 72 * 60 * 60 * 1000;
  return Date.now() - deliveredTime > WINDOW_MS;
}

/** El backend todavía no tiene `GET /ratings/eligibility` (una versión anterior): el único error con respaldo local. */
export function isEligibilityEndpointMissing(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 404;
}

export interface RatingAvailability {
  canRate: boolean;
  blockReason: RatingEligibility["reason"];
  /** Hasta cuándo se puede calificar (ISO), si el backend lo dijo. */
  windowEndsAt: string | null;
}

/**
 * Si se ofrece calificar a `rateeId` y, si no, qué motivo mostrar. Manda el backend (`eligibility`); el cálculo local
 * (ventana desde `deliveredAt`, disputa activa) queda solo para un backend sin el endpoint, porque no conoce las
 * disputas ya resueltas. Sin respuesta todavía, o ante cualquier otro error, no se ofrece.
 */
export function resolveRatingAvailability(
  shipment: ShipmentSummary,
  rateeId: string,
  eligibility: ShipmentRatingEligibility | undefined,
  eligibilityError: unknown
): RatingAvailability {
  if (eligibility) {
    const entry = eligibility.counterparties.find((c) => c.rateeId === rateeId);
    if (!entry) return { canRate: false, blockReason: null, windowEndsAt: null };
    return { canRate: entry.canRate, blockReason: entry.reason, windowEndsAt: entry.windowEndsAt };
  }
  if (!isEligibilityEndpointMissing(eligibilityError)) {
    return { canRate: false, blockReason: null, windowEndsAt: null };
  }
  if (shipment.status === ShipmentStatus.DISPUTED) {
    return { canRate: false, blockReason: "dispute_active", windowEndsAt: null };
  }
  if (!FULFILLED_SHIPMENT_STATUSES.includes(shipment.status)) {
    return { canRate: false, blockReason: "not_delivered", windowEndsAt: null };
  }
  if (isRatingWindowExpired(shipment.deliveredAt)) {
    return { canRate: false, blockReason: "window_expired", windowEndsAt: null };
  }
  return { canRate: true, blockReason: null, windowEndsAt: null };
}

export interface CounterpartyInfo {
  userId: string;
  roleLabel: string;
  /** MOVO-173: rol del CALIFICADO en este envío -- decide qué categorías muestra `RatingSheet`. */
  rateeRole: RatingRole;
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
      counterparties.push({ userId: shipment.carrierId, roleLabel: "Transportista", rateeRole: "carrier" });
    }
  } else if (isReceiver) {
    // El receptor interactúa únicamente con el transportista en la entrega
    if (shipment.carrierId) {
      counterparties.push({ userId: shipment.carrierId, roleLabel: "Transportista", rateeRole: "carrier" });
    }
  } else if (isCarrier) {
    // El transportista interactúa con ambas partes (retiro y entrega)
    counterparties.push({ userId: shipment.senderId, roleLabel: "Emisor", rateeRole: "sender" });
    counterparties.push({ userId: shipment.receiverId, roleLabel: "Receptor", rateeRole: "receiver" });
  }

  return counterparties;
}

function CounterpartyRatingRow({
  counterparty,
  myRating,
  availability: { canRate, blockReason, windowEndsAt },
  onRate,
  onViewProfile,
  testID,
}: {
  counterparty: CounterpartyInfo;
  myRating?: Rating;
  availability: RatingAvailability;
  onRate: (target: RatingTarget) => void;
  onViewProfile?: (userId: string) => void;
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
      photoUrl: profile?.photoUrl ?? null,
      roleLabel: counterparty.roleLabel,
      rateeRole: counterparty.rateeRole,
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
        <Pressable
          testID={testID ? `${testID}-profile-${counterparty.userId}` : `rating-row-profile-${counterparty.userId}`}
          onPress={onViewProfile ? () => onViewProfile(counterparty.userId) : undefined}
          disabled={!onViewProfile}
          accessibilityRole={onViewProfile ? "button" : undefined}
          accessibilityLabel={onViewProfile ? `Ver perfil de ${fullName}` : undefined}
          className={`flex-row items-center gap-3 flex-1 pr-2 ${onViewProfile ? "active:opacity-75" : ""}`}
        >
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
        </Pressable>

        {/* Action button */}
        {!hasRated && canRate ? (
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

        {hasRated && canRate ? (
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
      ) : blockReason === "window_expired" ? (
        <View className="flex-row items-center gap-1.5 pt-0.5">
          <Clock size={13} color={colors.fg3} />
          <Text className="font-sans text-[12px] text-fg-3">
            El plazo de 72 horas para calificar terminó
          </Text>
        </View>
      ) : blockReason === "dispute_active" ? (
        <View className="flex-row items-center gap-1.5 pt-0.5">
          <AlertCircle size={13} color="#D97706" />
          <Text className="font-sans text-[12px] text-amber-700 dark:text-amber-400">
            Vas a poder calificar cuando se resuelva la disputa
          </Text>
        </View>
      ) : blockReason === "dispute_lost" ? (
        <View className="flex-row items-center gap-1.5 pt-0.5">
          <AlertCircle size={13} color={colors.fg3} />
          <Text className="font-sans text-[12px] text-fg-3">
            Este envío tuvo una disputa: solo califica quien la ganó
          </Text>
        </View>
      ) : !canRate ? null : (
        <View className="flex-row items-center gap-1.5 pt-0.5">
          <Clock size={13} color={colors.fg3} />
          <Text className="font-sans text-[12px] text-fg-3">
            {windowEndsAt
              ? `Podés calificar hasta ${formatFundingDeadline(windowEndsAt)}`
              : "Tenés 72 hs desde la entrega para enviar tu opinión"}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * Sección de calificaciones en el detalle del envío (MOVO-153 / MOVO-22): las contrapartes que el usuario puede
 * calificar o ya calificó. Se muestra en cualquier envío terminado o en disputa; una contraparte que el backend dice
 * que no corresponde calificar (`not_delivered`, ej. un cancelado sin no-retiro) y sin calificación no aparece, y si no
 * queda ninguna, tampoco la sección.
 */
export function ShipmentRatingsCard({
  shipment,
  currentUserId,
  ratings,
  eligibility,
  eligibilityError,
  onRate,
  onViewProfile,
  header,
  testID,
}: ShipmentRatingsCardProps) {
  const rows = resolveCounterparties(shipment, currentUserId)
    .map((counterparty) => ({
      counterparty,
      myRating: ratings?.find((r) => r.raterId === currentUserId && r.rateeId === counterparty.userId),
      availability: resolveRatingAvailability(shipment, counterparty.userId, eligibility, eligibilityError),
    }))
    .filter(({ myRating, availability }) => myRating || availability.blockReason !== "not_delivered");

  if (rows.length === 0) return null;

  return (
    <View>
      {header}
      <View testID={testID ?? "shipment-ratings-card"} className="gap-3">
        {rows.map(({ counterparty, myRating, availability }) => (
          <CounterpartyRatingRow
            key={counterparty.userId}
            counterparty={counterparty}
            myRating={myRating}
            availability={availability}
            onRate={onRate}
            onViewProfile={onViewProfile}
            testID={testID}
          />
        ))}
      </View>
    </View>
  );
}
