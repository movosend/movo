import type { RecentRatingComment } from "@movo/shared/dist/types/user-profile";
import { Text, View } from "react-native";
import { formatRatingDate } from "../../src/lib/profile-format";
import { StarRatingInput } from "../ui/star-rating-input";

export interface ReputationCommentCardProps {
  comment: RecentRatingComment;
  /** `carousel` trunca a 3 líneas (tarjeta angosta del perfil); `list` muestra el
   * comentario completo (pantalla dedicada "Tus calificaciones"). Mismo componente en
   * los dos lugares — evita mantener dos markups del mismo dato. */
  variant?: "carousel" | "list";
  width?: number;
  testID?: string;
}

/** `raterId` viaja anónimo hoy (`raterName` es MOVO-170, todavía sin backend) — el
 * fallback nunca inventa un nombre. */
export function ReputationCommentCard({
  comment,
  variant = "carousel",
  width,
  testID,
}: ReputationCommentCardProps) {
  return (
    <View
      testID={testID}
      style={width ? { width } : undefined}
      className="gap-2 rounded-2xl border border-border bg-bg-mute p-3.5"
    >
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 font-sans-semibold text-small text-fg" numberOfLines={1}>
          {comment.raterName ?? "Un usuario de Movo"}
        </Text>
        <Text className="font-sans text-caption text-fg-3">{formatRatingDate(comment.createdAt)}</Text>
      </View>
      <StarRatingInput score={comment.score} readOnly size={12} gap={1.5} />
      {comment.comment ? (
        <Text
          className="font-sans text-small text-fg-2"
          numberOfLines={variant === "carousel" ? 3 : undefined}
        >
          {comment.comment}
        </Text>
      ) : null}
    </View>
  );
}
