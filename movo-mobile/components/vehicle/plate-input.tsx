import { Text, TextInput, View } from "react-native";
import { plateGroups, plateLength, type PlateFormat } from "../../src/lib/plate-format";

interface PlateInputProps {
  value: string;
  format: PlateFormat;
  onChangeText: (raw: string) => void;
  testID?: string;
}

/**
 * Casilleros de patente estilo chapa (mockup MOVO-223): un `TextInput`
 * invisible superpuesto capta el toque/teclado y el input real de texto —
 * los casilleros son puramente visuales, dibujados a partir de `value`.
 */
export function PlateInput({ value, format, onChangeText, testID }: PlateInputProps) {
  const groups = plateGroups(format);
  const total = plateLength(format);
  const cells: { ch: string; active: boolean; filled: boolean; marginRight: number }[] = [];

  let i = 0;
  groups.forEach((groupSize, groupIndex) => {
    for (let k = 0; k < groupSize; k++, i++) {
      cells.push({
        ch: value[i] ?? "",
        active: i === value.length,
        filled: !!value[i],
        marginRight: k === groupSize - 1 && groupIndex < groups.length - 1 ? 10 : 0,
      });
    }
  });

  return (
    <View className="relative rounded-[10px] border-[1.5px] border-ink-950/[0.08] bg-ink-50 p-3.5">
      <View className="flex-row items-center justify-center gap-1.5">
        {cells.map((cell, idx) => (
          <View
            key={idx}
            className={`h-[50px] w-9 items-center justify-center rounded-md border-[1.5px] ${
              cell.filled ? "bg-white" : "bg-ink-100"
            } ${cell.active ? "border-ink-950" : cell.filled ? "border-ink-950/[0.18]" : "border-ink-950/10"}`}
            style={{ marginRight: cell.marginRight }}
          >
            <Text className="font-mono-semibold text-[23px] text-ink-950">{cell.ch}</Text>
          </View>
        ))}
      </View>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={(raw) => onChangeText(raw)}
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        maxLength={total}
        className="absolute inset-0 h-full w-full opacity-0"
      />
    </View>
  );
}
