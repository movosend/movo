import type { RecentRatingComment } from "@movo/shared/dist/types/user-profile";
import { Text, View } from "react-native";
import { formatRaterRole, formatRatingDate, shouldShowRaterRole } from "../../src/lib/profile-format";
import { StarRatingInput } from "../ui/star-rating-input";

export interface ReputationCommentCardProps {
  comment: RecentRatingComment;
  /** `carousel` trunca el comentario (tarjeta del perfil); `list` lo muestra completo (pantalla dedicada
   * "Tus calificaciones"). Mismo componente en los dos lugares — evita mantener dos markups del mismo dato. */
  variant?: "carousel" | "list";
  width?: number;
  /** Forzar o esconder la insignia con el rol de quien calificó. Por defecto sigue `shouldShowRaterRole` (la misma
   * regla en el carrusel y en "Ver todas"). */
  showRaterRole?: boolean;
  testID?: string;
}

const CAROUSEL_COMMENT_LINES = 4;

/** `raterName` viaja siempre resuelto por `svc-users` (MOVO-170) — el fallback
 * solo cubre una cuenta de calificador ya borrada (derecho de supresión, MOVO-39),
 * nunca un dato ausente.
 *
 * Orden de lectura (MOVO-354): estrellas y fecha, el comentario como protagonista, y al pie quién
 * calificó con su rol en ese envío. El nombre ya no comparte renglón con la fecha, así que se lee entero. */
export function ReputationCommentCard({
  comment,
  variant = "carousel",
  width,
  showRaterRole = shouldShowRaterRole(comment),
  testID,
}: ReputationCommentCardProps) {
  const roleLabel = showRaterRole ? formatRaterRole(comment.raterRole) : null;
  const isCarousel = variant === "carousel";
  return (
    <View
      testID={testID}
      style={width ? { width } : undefined}
      className="gap-2.5 rounded-2xl border border-border bg-bg-mute p-3.5"
    >
      <View className="flex-row items-center justify-between">
        <StarRatingInput score={comment.score} readOnly size={13} gap={2} />
        <Text className="font-sans text-caption text-fg-3">{formatRatingDate(comment.createdAt)}</Text>
      </View>
      {comment.comment ? (
        <Text
          testID={testID ? `${testID}-text` : undefined}
          className="font-sans text-small text-fg"
          numberOfLines={isCarousel ? CAROUSEL_COMMENT_LINES : undefined}
        >
          {comment.comment}
        </Text>
      ) : (
        <Text className="font-sans text-small italic text-fg-3">Sin comentario</Text>
      )}
      <View className="flex-row items-center gap-2 border-t border-border pt-2.5">
        <Text className="flex-1 font-sans-semibold text-caption text-fg-2" numberOfLines={1}>
          {comment.raterName ?? "Un usuario de Movo"}
        </Text>
        {roleLabel ? (
          <View testID={testID ? `${testID}-role` : undefined} className="rounded-full bg-bg px-2 py-0.5">
            <Text className="font-sans-medium text-[11px] text-fg-2">{roleLabel}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
