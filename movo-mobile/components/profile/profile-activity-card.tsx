import type {
  RecentRatingComment,
  RecentRatingCommentsByRole,
  ReputationBreakdown,
  TransactionCounts,
} from "@movo/shared/dist/types/user-profile";
import { ChevronRight, Package, Star, Truck, WifiOff } from "lucide-react-native";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  formatRatingCount,
  formatRatingsMissing,
  formatReputationScore,
  formatShipmentCount,
  formatTripCount,
  hasSenderSide,
  ratingCommentsForRole,
} from "../../src/lib/profile-format";
import { SkeletonBlock } from "../ui/skeleton-block";
import { StarRatingInput } from "../ui/star-rating-input";
import { ReputationCommentCard } from "./reputation-comment-card";

type ReputationRole = "carrier" | "sender";

export interface ProfileActivityCardReputation {
  asSender: ReputationBreakdown;
  asCarrier: ReputationBreakdown;
  recentRatingComments: RecentRatingComment[];
  recentRatingCommentsByRole?: RecentRatingCommentsByRole;
}

export interface ProfileActivityCardProps {
  transactionCounts: TransactionCounts;
  reputationScore: number | null;
  /** Menos de 3 transacciones calificadas (MOVO-154, AC5) — reemplaza el número por
   * "Perfil nuevo" en la mini-card de "Tu actividad". */
  isNewProfile?: boolean;
  /** Desglose por rol + comentarios (`usePublicProfile`, segunda query, MOVO-154) —
   * `undefined` mientras no resuelve: la card se muestra igual, solo sin la sección de
   * reputación (degrada sin romper, mismo criterio que antes). */
  reputation?: ProfileActivityCardReputation;
  /** MOVO-168: la reputación viene de una segunda query -- mientras carga se ve la silueta de su
   * sección en vez de que aparezca de golpe y empuje lo de abajo. */
  reputationLoading?: boolean;
  /** MOVO-168: si esa segunda query falla, el aviso queda dentro de la card, con reintento local. */
  reputationError?: boolean;
  onRetryReputation?: () => void;
  /** "Ver todas" abre todas las calificaciones, de cualquier rol (no las de la pestaña elegida). */
  onViewAllRatings?: () => void;
  testID?: string;
}

const ROLE_LABEL: Record<ReputationRole, string> = {
  carrier: "Como Transportista",
  sender: "Como Emisor o Receptor",
};

/** Reseñas que muestra el carrusel de la card del perfil; el resto vive en "Tus calificaciones". */
const MAX_PREVIEW_COMMENTS = 3;
const CARD_WIDTH = 232;
const CARD_GAP = 10;

/**
 * Card única de "Tu actividad" + reputación del perfil PROPIO (MOVO-154, rediseño
 * post-feedback): antes eran dos bloques separados (`ProfileStatsRow` +
 * `ReputationDetail`, borrados) — acá viven en una sola card plana (sin el degradado "chrome",
 * MOVO-354) para las dos mitades. Los comentarios se muestran en un carrusel
 * horizontal con peek del siguiente (nunca una lista vertical que crece con cada
 * calificación nueva) — el resto vive en la pantalla dedicada `/profile/ratings`
 * (`onViewAllRatings`), mismo patrón que "Mis envíos"/"Mis viajes".
 */
export function ProfileActivityCard({
  transactionCounts,
  reputationScore,
  isNewProfile,
  reputation,
  reputationLoading = false,
  reputationError = false,
  onRetryReputation,
  onViewAllRatings,
  testID,
}: ProfileActivityCardProps) {
  const colors = useThemeColors();
  const hasCarrier = transactionCounts.asCarrier > 0;
  const hasSender = hasSenderSide(transactionCounts, reputation);
  const showRoleToggle = hasCarrier && hasSender;
  const [role, setRole] = useState<ReputationRole>(hasCarrier ? "carrier" : "sender");
  const [activeCommentIndex, setActiveCommentIndex] = useState(0);
  // Ancho disponible del carrusel: con una sola reseña la tarjeta ocupa todo (antes quedaba a 232 px,
  // dos tercios, con aire vacío al lado — feedback de TestFlight build 18); con varias se deja asomar la siguiente.
  const [carouselWidth, setCarouselWidth] = useState(0);

  const breakdown = reputation ? (role === "carrier" ? reputation.asCarrier : reputation.asSender) : undefined;
  // Las de la pestaña elegida: una reseña como transportista no va en "Como emisor" (feedback de TestFlight, build 17).
  // La card muestra solo las más recientes (el perfil las trae de más nueva a más vieja); el resto, en "Ver todas".
  const roleComments = reputation ? ratingCommentsForRole(reputation, role) : [];
  const comments = roleComments.slice(0, MAX_PREVIEW_COMMENTS);
  const allComments = reputation?.recentRatingComments ?? [];
  // "Ver todas" abre la pantalla con las reseñas de TODOS los roles: se compara contra el total del usuario, no contra el de
  // la pestaña (la lista del perfil llega acotada, por eso también se mira el conteo real).
  const totalRatings = Math.max(
    allComments.length,
    (reputation?.asCarrier.ratingCount ?? 0) + (reputation?.asSender.ratingCount ?? 0),
  );
  const hasMoreRatings = totalRatings > comments.length;
  // Perfil nuevo sin ningún comentario todavía: ni el score ni "lo que dicen de vos"
  // tienen nada real que mostrar (feedback: "toda esta sección es irrelevante") — se
  // oculta la sección entera en vez de mostrar el badge/nota vacíos de antes.
  const showReputationSection = Boolean(reputation && breakdown && !(isNewProfile && allComments.length === 0));

  const cardWidth =
    carouselWidth === 0
      ? CARD_WIDTH
      : comments.length === 1
        ? carouselWidth
        : Math.max(CARD_WIDTH, Math.round(carouselWidth * 0.86));

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP));
    setActiveCommentIndex(Math.max(0, Math.min(index, comments.length - 1)));
  };

  const stats = [
    { key: "shipments", Icon: Package, text: formatShipmentCount(transactionCounts.asSender) },
    { key: "trips", Icon: Truck, text: formatTripCount(transactionCounts.asCarrier) },
    { key: "score", Icon: Star, text: formatReputationScore(reputationScore, isNewProfile) },
  ];

  return (
    <View testID={testID} className="mb-5 rounded-[20px] border border-border bg-bg">
      <View style={{ padding: 14 }}>
        <Text className="mb-3 font-sans-medium text-caption uppercase text-fg-3">Tu actividad</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {stats.map(({ key, Icon, text }) => (
            <View
              key={key}
              style={{ flex: 1, flexBasis: 0, minHeight: 92 }}
              className="items-center justify-center gap-1.5 rounded-[14px] bg-bg-mute px-2 py-3.5"
            >
              <Icon size={18} strokeWidth={1.8} color={colors.fg3} />
              <Text className="text-center font-sans text-[12px] text-fg-2">{text}</Text>
            </View>
          ))}
        </View>

        {!reputation && reputationLoading ? (
          <ReputationSkeleton testID={testID ? `${testID}-reputation-skeleton` : undefined} />
        ) : !reputation && reputationError ? (
          <ReputationError
            testID={testID ? `${testID}-reputation-error` : undefined}
            onRetry={onRetryReputation}
          />
        ) : null}

        {showReputationSection && breakdown ? (
          <View testID={testID ? `${testID}-reputation` : undefined} style={{ marginTop: 18 }}>
            <View className="mb-4 h-px bg-border" />

            <Text className="mb-3 font-sans-semibold text-h3 text-fg">Tu reputación</Text>

            {showRoleToggle ? (
              <View className="mb-3.5 flex-row gap-1 rounded-xl bg-bg-mute p-1">
                {(["carrier", "sender"] as const).map((r) => (
                  <Pressable
                    key={r}
                    testID={testID ? `${testID}-role-${r}` : undefined}
                    onPress={() => {
                      // Cada pestaña tiene su propia lista: el carrusel vuelve a la primera reseña.
                      setRole(r);
                      setActiveCommentIndex(0);
                    }}
                    className={`flex-1 items-center rounded-lg py-2 ${role === r ? "bg-bg" : ""}`}
                  >
                    <Text
                      className={`font-sans-semibold text-[12.5px] ${role === r ? "text-fg" : "text-fg-3"}`}
                    >
                      {ROLE_LABEL[r]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {breakdown.isNewProfile ? (
              // Con menos calificaciones que el umbral (en ESTA pestaña) no hay puntaje que mostrar: ni el número
              // gigante ni las estrellas vacías comunican algo real. Se avisa cuántas faltan, en vez de repetir el
              // "Perfil nuevo" que ya muestra el cuadro de arriba (feedback de la review de MOVO-354).
              <Text
                testID={testID ? `${testID}-ratings-missing` : undefined}
                className="mb-5 font-sans text-small text-fg-2"
              >
                {formatRatingsMissing(breakdown.ratingCount)}
              </Text>
            ) : (
              <>
                <View className="mb-5 flex-row items-center gap-4">
                  <View className="flex-none gap-0.5">
                    <Text className="font-sans-semibold text-[38px] leading-[38px] text-fg">
                      {formatReputationScore(breakdown.reputationScore, breakdown.isNewProfile)}
                    </Text>
                    <Text className="font-sans text-[11px] text-fg-3">
                      {formatRatingCount(breakdown.ratingCount)}
                    </Text>
                  </View>
                  <StarRatingInput
                    score={breakdown.reputationScore ?? 0}
                    readOnly
                    size={16}
                    gap={3}
                    testID={testID ? `${testID}-stars` : undefined}
                  />
                </View>
              </>
            )}

            <View className="mb-2.5 flex-row items-center justify-between">
              <Text className="font-sans-medium text-caption uppercase text-fg-3">Lo que dicen de vos</Text>
              {hasMoreRatings && onViewAllRatings ? (
                <Pressable
                  testID={testID ? `${testID}-view-all` : undefined}
                  onPress={() => onViewAllRatings()}
                  hitSlop={8}
                  className="flex-row items-center gap-0.5"
                >
                  {/* Tinta, no lima: el lima sobre el fondo claro no llega a 2:1 (feedback de TestFlight builds 17 y 18). */}
                  <Text className="font-sans-semibold text-[12px] text-fg">Ver todas</Text>
                  <ChevronRight size={14} strokeWidth={2.2} color={colors.fg1} />
                </Pressable>
              ) : null}
            </View>

            {comments.length === 0 ? (
              <View
                testID={testID ? `${testID}-comments-empty` : undefined}
                className="items-center gap-1 rounded-2xl border border-dashed border-border-strong bg-bg-mute px-5 py-6"
              >
                <Text className="text-center font-sans-medium text-small text-fg-2">
                  Todavía no tenés calificaciones
                </Text>
                <Text className="max-w-[220px] text-center font-sans text-caption text-fg-3">
                  Van a aparecer acá apenas la otra parte confirme tu primer envío o viaje.
                </Text>
              </View>
            ) : (
              <>
                <ScrollView
                  key={role}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToInterval={cardWidth + CARD_GAP}
                  onLayout={(event) => setCarouselWidth(Math.round(event.nativeEvent.layout.width))}
                  contentContainerStyle={{ gap: CARD_GAP }}
                  onMomentumScrollEnd={handleScrollEnd}
                  scrollEventThrottle={16}
                  testID={testID ? `${testID}-comments-carousel` : undefined}
                >
                  {comments.map((comment) => (
                    <ReputationCommentCard
                      key={comment.id}
                      comment={comment}
                      variant="carousel"
                      width={cardWidth}
                      testID={testID ? `${testID}-comment-${comment.id}` : undefined}
                    />
                  ))}
                </ScrollView>
                {comments.length > 1 ? (
                  <View className="mt-3 flex-row justify-center gap-1.5">
                    {comments.map((comment, index) => (
                      <View
                        key={comment.id}
                        style={{ width: index === activeCommentIndex ? 14 : 5, height: 5 }}
                        className={`rounded-full ${index === activeCommentIndex ? "bg-fg" : "bg-border-strong"}`}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Silueta de "Tu reputación" (divisor, título, puntaje con estrellas, nota, y el encabezado + una
 * card de comentario): mismos márgenes que la sección real, para que no empuje lo de abajo al llegar. */
function ReputationSkeleton({ testID }: { testID?: string }) {
  return (
    <View testID={testID} style={{ marginTop: 18 }}>
      <View className="mb-4 h-px bg-border" />
      <SkeletonBlock className="mb-3 h-6 w-36 rounded-md" />
      <View className="mb-2.5 flex-row items-center gap-4">
        <View className="gap-1">
          <SkeletonBlock className="h-[38px] w-16 rounded-md" />
          <SkeletonBlock className="h-3 w-14 rounded" />
        </View>
        <SkeletonBlock className="h-4 w-28 rounded" />
      </View>
      <SkeletonBlock className="mb-5 h-3 w-4/5 rounded" />
      <SkeletonBlock className="mb-2.5 h-4 w-40 rounded" />
      <SkeletonBlock style={{ width: CARD_WIDTH }} className="h-[132px] rounded-2xl" />
    </View>
  );
}

function ReputationError({ testID, onRetry }: { testID?: string; onRetry?: () => void }) {
  const colors = useThemeColors();
  return (
    <View testID={testID} style={{ marginTop: 18 }}>
      <View className="mb-4 h-px bg-border" />
      <View className="items-center gap-2 py-3">
        <WifiOff size={20} strokeWidth={1.8} color={colors.fg3} />
        <Text className="text-center font-sans text-small text-fg-2">No pudimos cargar tu reputación.</Text>
        {onRetry ? (
          <Pressable
            testID={testID ? `${testID}-retry` : undefined}
            accessibilityRole="button"
            onPress={onRetry}
            hitSlop={8}
            className="min-h-[44px] items-center justify-center px-4"
          >
            <Text className="font-sans-medium text-small text-fg">Reintentar</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
