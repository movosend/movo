import { ChevronDown, ChevronUp, TrendingUp } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export const HIGH_DEMAND_HELP_TEXT =
  "Hay más envíos que transportistas en tu zona de retiro, por eso el precio sugerido es un poco más alto";

interface HighDemandBadgeProps {
  /** Modo controlado: si viene `onToggle`, el badge no despliega la ayuda adentro; la
   * pantalla la muestra donde le quede cómoda (`HighDemandHelp`). En el detalle del envío
   * va debajo de la fila de cards: desplegarla dentro de la card de precio (media pantalla)
   * estiraba también la card de retiro, porque la fila iguala la altura de sus hijas. */
  expanded?: boolean;
  onToggle?: () => void;
  /** Para cards angostas (la de precio del detalle va a media pantalla): la pill dice
   * solo "Alta demanda" y la explicación de la zona queda en el texto que se despliega. */
  compact?: boolean;
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
  compact = false,
  expanded: controlledExpanded,
  onToggle,
  testID = "high-demand-badge",
}: HighDemandBadgeProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const isControlled = onToggle !== undefined;
  const expanded = isControlled ? (controlledExpanded ?? false) : localExpanded;
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <View testID={testID}>
      <Pressable
        testID={`${testID}-toggle`}
        onPress={isControlled ? onToggle : () => setLocalExpanded((value) => !value)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Alta demanda en tu zona"
        accessibilityHint="Muestra por qué el precio sugerido es más alto"
        accessibilityState={{ expanded }}
        // `max-w-full` + `shrink`: la pill nunca crece más que su card (antes se salía y
        // `overflow-hidden` la cortaba, chevron incluido).
        className="max-w-full flex-row items-center gap-1 self-start rounded-full bg-ink-950 px-2.5 py-1 active:opacity-80"
      >
        <TrendingUp size={12} color="#FFFFFF" strokeWidth={2.25} />
        <Text numberOfLines={1} className="shrink font-sans-medium text-caption text-paper">
          {compact ? "Alta demanda" : "Alta demanda en tu zona"}
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

/** Explicación del recargo a ancho completo, para el modo controlado del badge. Mismo lima
 * que la card de precio, así se lee como continuación de la pill que la abrió. */
export function HighDemandHelp({ testID = "high-demand-help" }: { testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-start gap-2.5 rounded-[10px] bg-lime-200 px-3.5 py-3">
      <TrendingUp size={16} color="#0A0A0B" strokeWidth={2} style={{ marginTop: 1 }} />
      <Text className="flex-1 font-sans text-small leading-[19px] text-ink-950">{HIGH_DEMAND_HELP_TEXT}</Text>
    </View>
  );
}
