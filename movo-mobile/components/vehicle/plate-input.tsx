import { useRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { plateGroups, plateLength, type PlateFormat } from "../../src/lib/plate-format";

interface PlateInputProps {
  value: string;
  format: PlateFormat;
  onChangeText: (raw: string) => void;
  testID?: string;
}

/**
 * Casilleros de patente estilo chapa (mockup MOVO-223): un `TextInput`
 * invisible capta el teclado y el valor real — los casilleros son puramente
 * visuales, dibujados a partir de `value`. El toque se resuelve con un
 * `Pressable` que envuelve toda la caja y enfoca el input por `ref`
 * (`inputRef.current?.focus()`), en vez de depender de que el toque caiga
 * justo sobre el `TextInput` superpuesto — con el contenedor de alto
 * automático (sin `height` fijo), un `TextInput absolute` dimensionado con
 * `h-full`/`w-full` puede terminar colapsado a 0×0 y quedar imposible de
 * tocar (bug reportado: el campo no dejaba escribir ni abría el teclado).
 */
export function PlateInput({ value, format, onChangeText, testID }: PlateInputProps) {
  const inputRef = useRef<TextInput>(null);
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
    <Pressable
      className="relative rounded-[10px] border-[1.5px] border-ink-950/[0.08] bg-ink-50 p-3.5"
      onPress={() => inputRef.current?.focus()}
    >
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
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={(raw) => onChangeText(raw)}
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        maxLength={total}
        pointerEvents="none"
        className="absolute inset-0 opacity-0"
      />
    </Pressable>
  );
}
