import { ArrowUpRight, HandCoins, Route } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { PressableScale } from "../trips/pressable-scale";

interface TransportAccessCardsProps {
  tripsMeta: string;
  offersMeta: string;
  /** Punto lime pulsante (MOVO-183, prototipo) cuando alguna oferta requiere una
   * acción del transportista (una contraoferta que perdió el primer puesto, una
   * aceptada esperando confirmar el retiro) — ver `hasOffersRequiringAttention` en
   * `transport.tsx`. */
  offersNeedAttention: boolean;
  onPressTrips: () => void;
  onPressOffers: () => void;
}

/**
 * "Dos accesos con contador arriba" del rediseño (MOVO-183): reemplaza el botón
 * suelto "Mis viajes" del header (MOVO-162) por dos cards de mismo peso visual,
 * "Mis viajes" y "Mis ofertas" — el tab bar de abajo queda de 3 ítems que solo
 * navegan (Inicio/Transportar/Mi perfil), sin acceso a ninguna de las dos acá.
 *
 * MOVO-167: el ícono va sobre un círculo lima translúcido con el color de texto del
 * tema — el lima puro como color de ícono sobre `bg-bg-sub` no se leía en modo claro.
 */
export function TransportAccessCards({
  tripsMeta,
  offersMeta,
  offersNeedAttention,
  onPressTrips,
  onPressOffers,
}: TransportAccessCardsProps) {
  const colors = useThemeColors();
  return (
    <View className="flex-row gap-2.5 px-5 pb-5">
      <PressableScale
        testID="transport-my-trips-cta"
        onPress={onPressTrips}
        accessibilityRole="button"
        accessibilityLabel={`Mis viajes, ${tripsMeta}`}
        className="flex-1 gap-2.5 rounded-[10px] border border-border bg-bg-sub p-3.5"
      >
        <View className="flex-row items-center justify-between">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-lime-500/20">
            <Route size={16} strokeWidth={2} color={colors.fg1} />
          </View>
          <ArrowUpRight size={14} strokeWidth={1.8} color={colors.fg3} />
        </View>
        <View>
          <Text className="font-sans-semibold text-[14px] text-fg">Mis viajes</Text>
          <Text className="mt-0.5 font-sans text-[11.5px] text-fg-3">{tripsMeta}</Text>
        </View>
      </PressableScale>

      <PressableScale
        testID="transport-my-offers-cta"
        onPress={onPressOffers}
        accessibilityRole="button"
        accessibilityLabel={`Mis ofertas, ${offersMeta}`}
        className="flex-1 gap-2.5 rounded-[10px] border border-border bg-bg-sub p-3.5"
      >
        <View className="flex-row items-center justify-between">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-lime-500/20">
            <HandCoins size={16} strokeWidth={2} color={colors.fg1} />
          </View>
          <View className="flex-row items-center gap-1.5">
            {offersNeedAttention ? (
              <View testID="transport-my-offers-attention-dot" className="h-[7px] w-[7px] rounded-full bg-lime-500" />
            ) : null}
            <ArrowUpRight size={14} strokeWidth={1.8} color={colors.fg3} />
          </View>
        </View>
        <View>
          <Text className="font-sans-semibold text-[14px] text-fg">Mis ofertas</Text>
          <Text className="mt-0.5 font-sans text-[11.5px] text-fg-3">{offersMeta}</Text>
        </View>
      </PressableScale>
    </View>
  );
}
