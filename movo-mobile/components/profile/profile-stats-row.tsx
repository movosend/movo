import type { TransactionCounts } from "@movo/shared/dist/types/user-profile";
import { LinearGradient } from "expo-linear-gradient";
import { Package, Star, Truck } from "lucide-react-native";
import type { ReactNode } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import {
  formatReputationScore,
  formatShipmentCount,
  formatTripCount,
} from "../../src/lib/profile-format";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface ProfileStatsRowProps {
  transactionCounts: TransactionCounts;
  reputationScore: number | null;
  testID?: string;
}

/** Simula un borde "specular reflection" (más claro arriba-izquierda, se apaga hacia
 * abajo-derecha) envolviendo un `LinearGradient` de relleno dentro de otro que hace de
 * marco — RN no tiene border-image / border-gradient nativo, este es el approach
 * estándar para lograrlo con `expo-linear-gradient` solo. */
function GradientBorderCard({
  fillColors,
  borderColors,
  borderRadius,
  borderWidth = 1.5,
  style,
  children,
  testID,
}: {
  fillColors: readonly [string, string, ...string[]];
  borderColors: readonly [string, string, ...string[]];
  borderRadius: number;
  borderWidth?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <LinearGradient
      testID={testID}
      colors={borderColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius, padding: borderWidth }, style]}
    >
      <LinearGradient
        colors={fillColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, borderRadius: borderRadius - borderWidth }}
      >
        {children}
      </LinearGradient>
    </LinearGradient>
  );
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
