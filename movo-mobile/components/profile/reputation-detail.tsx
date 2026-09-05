import type { RecentRatingComment, ReputationBreakdown } from "@movo/shared/dist/types/user-profile";
import { Text, View } from "react-native";
import {
  formatRatingCount,
  formatRatingDate,
  formatReputationScore,
} from "../../src/lib/profile-format";
import { StarRatingInput } from "../ui/star-rating-input";

export interface ReputationDetailProps {
  asSender: ReputationBreakdown;
  asCarrier: ReputationBreakdown;
  recentRatingComments: RecentRatingComment[];
  testID?: string;
}

function RoleBreakdownRow({
  label,
  breakdown,
  testID,
}: {
  label: string;
  breakdown: ReputationBreakdown;
  testID?: string;
}) {
  const countLabel = formatRatingCount(breakdown.ratingCount);
  return (
    <View testID={testID} className="flex-row items-center justify-between py-2">
      <Text className="font-sans-medium text-small text-fg-2">{label}</Text>
      <View className="flex-row items-center gap-2">
        <StarRatingInput
          score={breakdown.reputationScore ?? 0}
          readOnly
          size={14}
          gap={2}
          testID={testID ? `${testID}-stars` : undefined}
        />
        <Text className="font-sans-medium text-small text-fg">
          {formatReputationScore(breakdown.reputationScore, breakdown.isNewProfile)}
        </Text>
        {countLabel && !breakdown.isNewProfile ? (
          <Text className="font-sans text-caption text-fg-3">({countLabel})</Text>
        ) : null}
      </View>
    </View>
  );
}

function CommentRow({ comment, testID }: { comment: RecentRatingComment; testID?: string }) {
  return (
    <View testID={testID} className="gap-1.5 py-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <StarRatingInput score={comment.score} readOnly size={12} gap={1.5} />
          <Text className="font-sans-medium text-caption text-fg-2">{comment.score.toFixed(1)}</Text>
        </View>
        <Text className="font-sans text-caption text-fg-3">
          {formatRatingDate(comment.createdAt)}
        </Text>
      </View>
      {comment.comment ? (
        <Text className="font-sans text-small text-fg-2">{comment.comment}</Text>
      ) : null}
    </View>
  );
}

/**
 * Desglose de reputación por rol + últimas calificaciones (MOVO-154, AC2/AC3/AC5/
 * AC6/AC8). Puramente presentacional — sin fetch propio, recibe la porción de
 * reputación ya resuelta de un `PublicProfile` (o del `usePublicProfile` del propio
 * usuario en el perfil privado, ver `app/(app)/(tabs)/profile.tsx`). Se renderiza
 * siempre inline debajo de `ProfileStatsRow`, nunca detrás de una pantalla o sheet
 * aparte — el AC8 solo pide que la explicación del cálculo sea "accesible desde el
 * perfil", no un flujo de navegación nuevo.
 */
export function ReputationDetail({
  asSender,
  asCarrier,
  recentRatingComments,
  testID,
}: ReputationDetailProps) {
  return (
    <View testID={testID} className="gap-4">
      <View className="rounded-2xl border border-border bg-bg px-4 py-1">
        <RoleBreakdownRow label="Como emisor" breakdown={asSender} testID={testID ? `${testID}-sender` : undefined} />
        <View className="h-px bg-border" />
        <RoleBreakdownRow
          label="Como transportista"
          breakdown={asCarrier}
          testID={testID ? `${testID}-carrier` : undefined}
        />
      </View>

      <Text className="font-sans text-caption text-fg-3">
        Promedio ponderado: las calificaciones recientes pesan más, y hacen falta
        varias para que se mueva.
      </Text>

      <View>
        <Text className="mb-2 font-sans-medium text-caption uppercase text-fg-3">
          Comentarios recientes
        </Text>
        {recentRatingComments.length === 0 ? (
          <Text testID={testID ? `${testID}-comments-empty` : undefined} className="font-sans text-small text-fg-3">
            Todavía no tiene comentarios.
          </Text>
        ) : (
          <View>
            {recentRatingComments.map((comment, index) => (
              <View key={comment.id}>
                {index > 0 ? <View className="h-px bg-border" /> : null}
                <CommentRow comment={comment} testID={testID ? `${testID}-comment-${comment.id}` : undefined} />
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
