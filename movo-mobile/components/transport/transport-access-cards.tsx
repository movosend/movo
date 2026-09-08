import { ArrowUpRight, HandCoins, Route } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

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
 */
export function TransportAccessCards({
  tripsMeta,
  offersMeta,
  offersNeedAttention,
  onPressTrips,
  onPressOffers,
}: TransportAccessCardsProps) {
  return (
    <View className="flex-row gap-2.5 px-5 pb-5">
      <Pressable
        testID="transport-my-trips-cta"
        onPress={onPressTrips}
        className="flex-1 gap-2.5 rounded-[10px] border border-border bg-bg-sub p-3.5"
      >
        <View className="flex-row items-center justify-between">
          <Route size={18} strokeWidth={1.8} color="#C6F24A" />
          <ArrowUpRight size={14} strokeWidth={1.8} color="#B4B4BC" />
        </View>
        <View>
          <Text className="font-sans-semibold text-[14px] text-fg">Mis viajes</Text>
          <Text className="mt-0.5 font-sans text-[11.5px] text-fg-3">{tripsMeta}</Text>
        </View>
      </Pressable>

      <Pressable
        testID="transport-my-offers-cta"
        onPress={onPressOffers}
        className="flex-1 gap-2.5 rounded-[10px] border border-border bg-bg-sub p-3.5"
      >
        <View className="flex-row items-center justify-between">
          <HandCoins size={18} strokeWidth={1.8} color="#C6F24A" />
          <View className="flex-row items-center gap-1.5">
            {offersNeedAttention ? (
              <View testID="transport-my-offers-attention-dot" className="h-[7px] w-[7px] rounded-full bg-lime-500" />
            ) : null}
            <ArrowUpRight size={14} strokeWidth={1.8} color="#B4B4BC" />
          </View>
        </View>
        <View>
          <Text className="font-sans-semibold text-[14px] text-fg">Mis ofertas</Text>
          <Text className="mt-0.5 font-sans text-[11.5px] text-fg-3">{offersMeta}</Text>
        </View>
      </Pressable>
    </View>
  );
}
