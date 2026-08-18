import { Inbox } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface OffersBannerProps {
  testID?: string;
}

/**
 * Punto de extensión para MOVO-17 (ofertas), sin arrancar todavía — de momento
 * siempre muestra el estado vacío ("Aún no tenés ofertas"), no navega a ningún lado
 * (no hay pantalla de ofertas real). Decisión post-QA con el usuario (feedback de
 * MOVO-127, el AC original excluía este banner del alcance): mejor dejar el lugar
 * planteado en la pantalla que omitirlo — cuando MOVO-17 exista, este componente pasa
 * a recibir el conteo real y un `onPress` que navegue a la lista de ofertas, mismo
 * criterio visual "bloqueado" que `HomeSendCta` (icono en círculo mute, texto `fg`/
 * `fg-2`, sin acento de color hasta que la acción sea real).
 */
export function OffersBanner({ testID }: OffersBannerProps) {
  const colors = useThemeColors();

  return (
    <View testID={testID} className="flex-row items-center gap-3 rounded-[12px] bg-bg-mute px-4 py-3.5">
      <View className="h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-fg/10">
        <Inbox size={18} color={colors.fg3} strokeWidth={1.8} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-semibold text-[15px] text-fg">Ofertas</Text>
        <Text className="mt-0.5 font-sans text-[12px] text-fg-3">Aún no tenés ofertas</Text>
      </View>
    </View>
  );
}
