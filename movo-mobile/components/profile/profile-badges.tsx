import type { ProfileBadge } from "@movo/shared/dist/types/user-profile";
import { IdCard, ShieldCheck, type LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";

const BADGE_META: Record<ProfileBadge, { label: string; Icon: LucideIcon }> = {
  kyc_verified: { label: "Identidad verificada", Icon: ShieldCheck },
  license_verified: { label: "Licencia verificada", Icon: IdCard },
};

export interface ProfileBadgesProps {
  badges: ProfileBadge[];
  testID?: string;
}

/** Fila de insignias activas (MOVO-78 AC5), salvo `kyc_verified` — el caller la filtra
 * antes de pasar `badges` acá porque esa insignia se muestra integrada junto al nombre
 * (`ProfileVerifiedBadge`), no como chip genérico de esta fila. Sin insignias, no
 * renderiza nada — no hay placeholder de "sin insignias todavía", a diferencia de los
 * stats (AC10), porque acá no hay ninguna expectativa de que exista un valor por
 * defecto que mostrar. Props compatibles con `PublicProfile` (mismo campo `badges` en
 * ambas proyecciones). */
export function ProfileBadges({ badges, testID }: ProfileBadgesProps) {
  if (badges.length === 0) return null;

  return (
    <View testID={testID} className="mb-5 flex-row flex-wrap gap-2">
      {badges.map((badge) => {
        const { label, Icon } = BADGE_META[badge];
        return (
          <View
            key={badge}
            className="flex-row items-center gap-1.5 rounded-full bg-lime-200 px-3 py-1.5"
          >
            <Icon size={14} strokeWidth={2} color="#0A0A0B" />
            <Text className="font-sans-medium text-[12px] text-ink-950">{label}</Text>
          </View>
        );
      })}
    </View>
  );
}
