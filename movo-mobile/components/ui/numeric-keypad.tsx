import { Delete } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

export const KEYPAD_KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "00",
  "0",
  "⌫",
];

/**
 * Teclado numérico dibujado a mano (no el nativo, `keyboardType="number-pad"`) —
 * decisión de diseño explícita del usuario en MOVO-177 (rechazó el input nativo
 * después de probarlo). Extraído de `transport/[id]/offer.tsx` para reusarlo en la
 * hoja "Cambiar el precio" del detalle de oferta (MOVO-182) sin duplicar el patrón.
 */
export function NumericKeypad({
  onDigit,
  onDelete,
  testIDPrefix = "numeric-keypad-key",
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  /** Default preservado para no romper testIDs existentes (`create-offer-key-*`,
   * `offer-detail-price-key-*`) — cada caller pasa el suyo. */
  testIDPrefix?: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-2 px-4 pb-6 pt-1">
      {KEYPAD_KEYS.map((key) => (
        <Pressable
          key={key}
          testID={`${testIDPrefix}-${key === "⌫" ? "del" : key}`}
          onPress={() => (key === "⌫" ? onDelete() : onDigit(key))}
          className="h-12 flex-[1_0_30%] items-center justify-center rounded-md bg-bg-mute"
        >
          {key === "⌫" ? (
            <Delete size={20} color="#0A0A0B" />
          ) : (
            <Text className="font-sans-medium text-[20px] text-fg">{key}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}
