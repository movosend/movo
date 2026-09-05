import type { ReputationBreakdown } from "@movo/shared/dist/types/user-profile";
import { Pressable, Text, View } from "react-native";
import { formatRatingCount, formatReputationScore } from "../../src/lib/profile-format";
import { StarRatingInput } from "../ui/star-rating-input";

export type ReputationRole = "carrier" | "sender";

export interface ReputationCardProps {
  /** `PublicProfile` no expone `roles` (eso es privado) — la disponibilidad de
   * cada tab del toggle se infiere de si la persona tiene alguna transacción real
   * en ese rol (`hasCarrier`/`hasSender`), no de una lista de roles de cuenta. */
  hasCarrier: boolean;
  hasSender: boolean;
  role: ReputationRole;
  onRoleChange: (role: ReputationRole) => void;
  asSender: ReputationBreakdown;
  asCarrier: ReputationBreakdown;
  testID?: string;
}

type Role = ReputationRole;

const SCORE_NOTE: Record<Role, string> = {
  carrier: "Promedio ponderado: las calificaciones recientes pesan más, y hacen falta varias para que se mueva.",
  sender: "Calificada por las personas que llevaron tus envíos — las recientes pesan más.",
};

const ROLE_LABEL: Record<Role, string> = {
  carrier: "Como transportista",
  sender: "Como emisor",
};

function CategoryBar({ label, score }: { label: string; score: number }) {
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-[92px] flex-none text-right font-sans text-[11px] text-fg-2" numberOfLines={1}>
        {label}
      </Text>
      <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-mute">
        <View className="h-full rounded-full bg-lime-500" style={{ width: `${pct}%` }} />
      </View>
      <Text className="w-6 flex-none font-sans-semibold text-[11px] text-fg">{score.toFixed(1)}</Text>
    </View>
  );
}

/**
 * Score + desglose por rol del rediseño de perfil (MOVO-176) — reemplaza el
 * stacking siempre-visible de `ReputationDetail` (MOVO-154, que sigue usándose tal
 * cual en el perfil PROPIO, `app/(app)/(tabs)/profile.tsx`) por un toggle que
 * muestra un rol a la vez, con barras de categoría debajo cuando existan
 * (`breakdown.categories`, MOVO-173 — todavía sin backend, así que hoy la card se
 * ve igual que antes, sin hueco vacío).
 */
export function ReputationCard({
  hasCarrier,
  hasSender,
  role,
  onRoleChange,
  asSender,
  asCarrier,
  testID,
}: ReputationCardProps) {
  const breakdown = role === "carrier" ? asCarrier : asSender;
  const showToggle = hasCarrier && hasSender;

  return (
    <View testID={testID} className="gap-3 rounded-[16px] border border-border bg-bg p-1">
      {showToggle ? (
        <View className="flex-row gap-1 rounded-xl bg-bg-mute p-1">
          {(["carrier", "sender"] as const).map((r) => (
            <Pressable
              key={r}
              testID={testID ? `${testID}-role-${r}` : undefined}
              onPress={() => onRoleChange(r)}
              className={`flex-1 items-center rounded-lg py-2 ${role === r ? "bg-bg" : ""}`}
            >
              <Text
                className={`font-sans-semibold text-[12.5px] ${
                  role === r ? "text-fg" : "text-fg-3"
                }`}
              >
                {ROLE_LABEL[r]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View className="gap-3 px-3 pb-3 pt-1">
        <View className="flex-row items-center gap-4">
          <View className="flex-none gap-0.5">
            <Text className="font-sans-semibold text-[38px] leading-[38px] text-fg">
              {formatReputationScore(breakdown.reputationScore, breakdown.isNewProfile)}
            </Text>
            {!breakdown.isNewProfile ? (
              <Text className="font-sans text-[11px] text-fg-3">
                {formatRatingCount(breakdown.ratingCount)}
              </Text>
            ) : null}
          </View>
          <View className="flex-1 gap-1.5">
            <StarRatingInput
              score={breakdown.reputationScore ?? 0}
              readOnly
              size={16}
              gap={3}
              testID={testID ? `${testID}-stars` : undefined}
            />
            {breakdown.categories && breakdown.categories.length > 0 ? (
              <View className="mt-1 gap-1.5">
                {breakdown.categories.map((c) => (
                  <CategoryBar key={c.key} label={c.label} score={c.score} />
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <Text className="font-sans text-[11.5px] text-fg-3">{SCORE_NOTE[role]}</Text>
      </View>
    </View>
  );
}
