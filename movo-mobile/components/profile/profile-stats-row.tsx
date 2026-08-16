import type { TransactionCounts } from "@movo/shared/dist/types/user-profile";
import { Package, Star, Truck } from "lucide-react-native";
import { Text, View } from "react-native";
import {
  formatReputationScore,
  formatShipmentCount,
  formatTripCount,
} from "../../src/lib/profile-format";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { GradientBorderCard } from "../ui/gradient-border-card";

export interface ProfileStatsRowProps {
  transactionCounts: TransactionCounts;
  reputationScore: number | null;
  testID?: string;
}

/** 3 cards (envíos/viajes/calificación), MOVO-78 AC2/AC10. Nunca interpola el número
 * crudo — siempre pasa por `profile-format.ts` para que el estado en cero (el que va
 * a estar activo en la Sprint Review) se vea intencional. Props compatibles con
 * `PublicProfile` (mismos 2 campos existen ahí). */
export function ProfileStatsRow({ transactionCounts, reputationScore, testID }: ProfileStatsRowProps) {
  const colors = useThemeColors();

  const stats = [
    { key: "shipments", Icon: Package, text: formatShipmentCount(transactionCounts.asSender) },
    { key: "trips", Icon: Truck, text: formatTripCount(transactionCounts.asCarrier) },
    { key: "score", Icon: Star, text: formatReputationScore(reputationScore) },
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
      </View>
    </GradientBorderCard>
  );
}
