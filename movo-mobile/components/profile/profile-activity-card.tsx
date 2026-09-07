import type {
  RecentRatingComment,
  ReputationBreakdown,
  TransactionCounts,
} from "@movo/shared/dist/types/user-profile";
import { ChevronRight, Package, Star, Truck } from "lucide-react-native";
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
  formatReputationScore,
  formatShipmentCount,
  formatTripCount,
} from "../../src/lib/profile-format";
import { GradientBorderCard } from "../ui/gradient-border-card";
import { StarRatingInput } from "../ui/star-rating-input";
import { ReputationCommentCard } from "./reputation-comment-card";

type ReputationRole = "carrier" | "sender";

export interface ProfileActivityCardReputation {
  asSender: ReputationBreakdown;
  asCarrier: ReputationBreakdown;
  recentRatingComments: RecentRatingComment[];
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
  onViewAllRatings?: () => void;
  testID?: string;
}

const ROLE_LABEL: Record<ReputationRole, string> = {
  carrier: "Como transportista",
  sender: "Como emisor",
};

const SCORE_NOTE: Record<ReputationRole, string> = {
  carrier: "Promedio ponderado: las calificaciones recientes pesan más.",
  sender: "Calificada por quienes llevaron tus envíos — las recientes pesan más.",
};

const CARD_WIDTH = 232;
const CARD_GAP = 10;

/**
 * Card única de "Tu actividad" + reputación del perfil PROPIO (MOVO-154, rediseño
 * post-feedback): antes eran dos bloques separados (`ProfileStatsRow` +
 * `ReputationDetail`, borrados) — acá viven en un solo `GradientBorderCard`, mismo
 * lenguaje "chrome" para las dos mitades. Los comentarios se muestran en un carrusel
 * horizontal con peek del siguiente (nunca una lista vertical que crece con cada
 * calificación nueva) — el resto vive en la pantalla dedicada `/profile/ratings`
 * (`onViewAllRatings`), mismo patrón que "Mis envíos"/"Mis viajes".
 */
export function ProfileActivityCard({
  transactionCounts,
  reputationScore,
  isNewProfile,
  reputation,
  onViewAllRatings,
  testID,
}: ProfileActivityCardProps) {
  const colors = useThemeColors();
  const hasCarrier = transactionCounts.asCarrier > 0;
  const hasSender = transactionCounts.asSender > 0;
  const showRoleToggle = hasCarrier && hasSender;
  const [role, setRole] = useState<ReputationRole>(hasCarrier ? "carrier" : "sender");
  const [activeCommentIndex, setActiveCommentIndex] = useState(0);

  const breakdown = reputation ? (role === "carrier" ? reputation.asCarrier : reputation.asSender) : undefined;
  const comments = reputation?.recentRatingComments ?? [];
  // Perfil nuevo sin ningún comentario todavía: ni el score ni "lo que dicen de vos"
  // tienen nada real que mostrar (feedback: "toda esta sección es irrelevante") — se
  // oculta la sección entera en vez de mostrar el badge/nota vacíos de antes.
  const showReputationSection = Boolean(reputation && breakdown && !(isNewProfile && comments.length === 0));

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / (CARD_WIDTH + CARD_GAP));
    setActiveCommentIndex(Math.max(0, Math.min(index, comments.length - 1)));
  };

  const stats = [
    { key: "shipments", Icon: Package, text: formatShipmentCount(transactionCounts.asSender) },
    { key: "trips", Icon: Truck, text: formatTripCount(transactionCounts.asCarrier) },
    { key: "score", Icon: Star, text: formatReputationScore(reputationScore, isNewProfile) },
  ];

  return (
    <GradientBorderCard
      testID={testID}
      fillColors={colors.chromeOuterGradient}
      borderColors={colors.chromeOuterBorderGradient}
      borderRadius={20}
      borderWidth={1.5}
      style={{
        marginBottom: 20,
        shadowColor: colors.chromeShadow,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 1,
        shadowRadius: 10,
        elevation: 4,
      }}
    >
      <View style={{ padding: 14 }}>
        <Text className="mb-3 font-sans-medium text-caption uppercase text-fg-3">Tu actividad</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {stats.map(({ key, Icon, text }) => (
            <GradientBorderCard
              key={key}
              fillColors={colors.chromeGradient}
              borderColors={colors.chromeBorderGradient}
              borderRadius={14}
              borderWidth={1.25}
              style={{ flex: 1, flexBasis: 0, minHeight: 92 }}
            >
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingHorizontal: 8,
                  paddingVertical: 14,
                }}
              >
                <Icon size={18} strokeWidth={1.8} color={colors.fg3} />
                <Text className="text-center font-sans text-[12px] text-fg-2">{text}</Text>
              </View>
            </GradientBorderCard>
          ))}
        </View>

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
                    onPress={() => setRole(r)}
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
              // Sin ninguna calificación todavía: ni el número gigante ni las 5
              // estrellas vacías comunican algo real (feedback: "es irrelevante
              // mostrar las stars vacías" — un score de 38px pidiendo el mismo
              // protagonismo que un score real también exageraba lo que hay para
              // mostrar). Un badge chico alcanza.
              <View
                testID={testID ? `${testID}-new-badge` : undefined}
                className="mb-5 flex-row self-start rounded-full bg-lime-500 px-2.5 py-1"
              >
                <Text className="font-sans-semibold text-[11px] uppercase tracking-wide text-ink-950">
                  Perfil nuevo
                </Text>
              </View>
            ) : (
              <>
                <View className="mb-2.5 flex-row items-center gap-4">
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
                <Text className="mb-5 font-sans text-[11.5px] text-fg-3">{SCORE_NOTE[role]}</Text>
              </>
            )}

            <View className="mb-2.5 flex-row items-center justify-between">
              <Text className="font-sans-medium text-caption uppercase text-fg-3">Lo que dicen de vos</Text>
              {comments.length > 0 && onViewAllRatings ? (
                <Pressable
                  testID={testID ? `${testID}-view-all` : undefined}
                  onPress={onViewAllRatings}
                  hitSlop={8}
                  className="flex-row items-center gap-0.5"
                >
                  <Text className="font-sans-semibold text-[12px] text-lime-500">Ver todas</Text>
                  <ChevronRight size={14} strokeWidth={2.2} color="#C6F24A" />
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
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToInterval={CARD_WIDTH + CARD_GAP}
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
                      width={CARD_WIDTH}
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
                        className={`rounded-full ${index === activeCommentIndex ? "bg-lime-500" : "bg-bg-mute"}`}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    </GradientBorderCard>
  );
}
