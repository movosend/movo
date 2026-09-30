import { ChevronDown, ChevronUp, TrendingUp } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export const HIGH_DEMAND_HELP_TEXT =
  "Hay más envíos que transportistas en tu zona de retiro, por eso el precio sugerido es un poco más alto";

interface HighDemandBadgeProps {
  testID?: string;
}

/**
 * Badge "Alta demanda en tu zona" (MOVO-254, ADR-025): explica el recargo por alta
 * demanda del precio sugerido sin mostrar el porcentaje (el emisor no recibe el
 * desglose). Cuándo mostrarlo lo decide el caller (`highDemand === true` y precio
 * todavía sugerido). Pensado para ir sobre las cards lima de precio: pill en tinta
 * fija, no un acento lima propio. La ayuda se despliega con un tap en vez de un
 * tooltip flotante, que exigiría medir la posición con `measureInWindow`.
 */
export function HighDemandBadge({ testID = "high-demand-badge" }: HighDemandBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <View testID={testID}>
      <Pressable
        testID={`${testID}-toggle`}
        onPress={() => setExpanded((value) => !value)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Alta demanda en tu zona"
        accessibilityHint="Muestra por qué el precio sugerido es más alto"
        accessibilityState={{ expanded }}
        className="flex-row items-center gap-1 self-start rounded-full bg-ink-950 px-2.5 py-1 active:opacity-80"
      >
        <TrendingUp size={12} color="#FFFFFF" strokeWidth={2.25} />
        <Text className="font-sans-medium text-caption text-paper">Alta demanda en tu zona</Text>
        <Chevron size={12} color="#FFFFFF" strokeWidth={2.25} />
      </Pressable>
      {expanded ? (
        <Text testID={`${testID}-help`} className="mt-1.5 font-sans text-small text-ink-950/70">
          {HIGH_DEMAND_HELP_TEXT}
        </Text>
      ) : null}
    </View>
  );
}
