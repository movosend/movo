import { ChevronDown, ChevronUp, TrendingUp } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export const HIGH_DEMAND_HELP_TEXT =
  "Hay más envíos que transportistas en tu zona de retiro, por eso el precio sugerido es un poco más alto";

interface HighDemandBadgeProps {
  /** Texto de la pill. En espacios angostos (la card de precio del detalle) va "Alta demanda". */
  label?: string;
  /** Controlado: el caller muestra la ayuda donde tenga lugar (ver `HighDemandHelp`). Sin
   * `onToggle`, la ayuda se despliega debajo de la pill. */
  expanded?: boolean;
  onToggle?: () => void;
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
export function HighDemandBadge({
  label = "Alta demanda en tu zona",
  expanded: controlledExpanded,
  onToggle,
  testID = "high-demand-badge",
}: HighDemandBadgeProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const isControlled = onToggle !== undefined;
  const expanded = isControlled ? controlledExpanded === true : localExpanded;
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <View testID={testID}>
      <Pressable
        testID={`${testID}-toggle`}
        onPress={() => (isControlled ? onToggle() : setLocalExpanded((value) => !value))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Alta demanda en tu zona"
        accessibilityHint="Muestra por qué el precio sugerido es más alto"
        accessibilityState={{ expanded }}
        className="max-w-full flex-row items-center gap-1 self-start rounded-full bg-ink-950 px-2.5 py-1 active:opacity-80"
      >
        <TrendingUp size={12} color="#FFFFFF" strokeWidth={2.25} />
        <Text numberOfLines={1} className="flex-shrink font-sans-medium text-caption text-paper">
          {label}
        </Text>
        <Chevron size={12} color="#FFFFFF" strokeWidth={2.25} />
      </Pressable>
      {expanded && !isControlled ? (
        <Text testID={`${testID}-help`} className="mt-1.5 font-sans text-small text-ink-950/70">
          {HIGH_DEMAND_HELP_TEXT}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Ayuda del badge a todo el ancho, para cuando la pill vive en una card angosta (detalle del
 * envío): desplegarla adentro de media card la estiraba y desalineaba la fila.
 */
export function HighDemandHelp({ testID = "high-demand-help" }: { testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-start gap-2.5 rounded-[10px] bg-lime-200 px-3.5 py-3">
      <TrendingUp size={16} color="#0A0A0B" strokeWidth={2} style={{ marginTop: 1 }} />
      <Text className="flex-1 font-sans text-small text-ink-950/80">{HIGH_DEMAND_HELP_TEXT}</Text>
    </View>
  );
}
