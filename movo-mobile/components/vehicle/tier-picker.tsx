import { Pressable, Text, View } from "react-native";
import { CARGO_TIERS } from "../../src/data/vehicle-catalog";

interface TierPickerProps {
  value: string;
  onChange: (tierId: string) => void;
  testID?: string;
}

/** Lista de volúmenes de carga estándar (`CARGO_TIERS`, hoy S a XXXL) — usada en el
 * paso manual y para ajustar el volumen calculado en el paso de patente. El badge del
 * id usa `min-w` + padding horizontal (no un cuadrado fijo): el catálogo puede sumar
 * ids de más de 2-3 caracteres (`XXXL`) sin que el texto se corte. */
export function TierPicker({ value, onChange, testID }: TierPickerProps) {
  return (
    <View className="gap-2">
      {CARGO_TIERS.map((tier) => {
        const selected = value === tier.id;
        return (
          <Pressable
            key={tier.id}
            testID={testID ? `${testID}-${tier.id}` : undefined}
            onPress={() => onChange(tier.id)}
            className={`flex-row items-center gap-3 rounded-lg border-[1.5px] px-3.5 py-3 ${
              selected ? "border-ink-950 bg-lime-200/40" : "border-ink-950/[0.08] bg-white"
            }`}
          >
            <View className="h-[30px] min-w-[30px] items-center justify-center rounded-md bg-ink-950 px-1.5">
              <Text className="font-mono-semibold text-[12px] text-lime-500">{tier.id}</Text>
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="font-sans-medium text-[14px] text-ink-950">{tier.cap}</Text>
              <Text className="font-sans text-[11.5px] text-ink-400">{tier.ex}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
