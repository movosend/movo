import type { UsageStats } from "@movo/shared/dist/types/user-profile";
import { Text, View } from "react-native";

export interface UsageStatsGridProps {
  usageStats: UsageStats | undefined;
  role: "carrier" | "sender";
  testID?: string;
}

function formatWeight(kg: number | null): string {
  if (kg === null) return "Sin datos";
  return `${kg.toFixed(1)} kg`;
}

/**
 * Grilla 2x2 de stats de uso (subconjunto "calculable ahora" del rediseño de
 * perfil, MOVO-170 — todavía sin backend). Se oculta la sección completa si
 * `usageStats` no viene, en vez de mostrar ceros que parecerían datos reales.
 */
export function UsageStatsGrid({ usageStats, role, testID }: UsageStatsGridProps) {
  if (!usageStats) return null;

  const stats = [
    {
      key: "delivered",
      label: role === "carrier" ? "Entregas" : "Envíos hechos",
      value: String(usageStats.delivered),
      sub: usageStats.cancelled > 0 ? `${usageStats.cancelled} cancelado${usageStats.cancelled === 1 ? "" : "s"}` : "Sin cancelaciones",
    },
    {
      key: "avgWeight",
      label: role === "carrier" ? "Peso promedio llevado" : "Paquete típico",
      value: formatWeight(usageStats.avgPackageWeightKg),
      sub: role === "carrier" ? "Por envío entregado" : "Peso promedio",
    },
  ];

  return (
    <View testID={testID} className="flex-row flex-wrap gap-2.5">
      {stats.map(({ key, label, value, sub }) => (
        <View
          key={key}
          testID={testID ? `${testID}-${key}` : undefined}
          className="flex-1 gap-1 rounded-[14px] border border-border bg-bg-sub px-3.5 py-3.5"
          style={{ minWidth: "45%" }}
        >
          <Text className="font-sans-medium text-[10px] uppercase tracking-wide text-fg-3">
            {label}
          </Text>
          <Text className="font-sans-semibold text-[20px] text-fg">{value}</Text>
          <Text className="font-sans text-[11.5px] text-fg-2">{sub}</Text>
        </View>
      ))}
    </View>
  );
}
