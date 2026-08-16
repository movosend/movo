import { Pressable, Text, TextInput, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const TIME_WINDOWS: { start: string; end: string; label: string }[] = [
  { start: "09:00", end: "12:00", label: "09:00 – 12:00" },
  { start: "12:00", end: "18:00", label: "12:00 – 18:00" },
  { start: "18:00", end: "22:00", label: "18:00 – 22:00" },
];

interface TimeWindowPickerProps {
  pickupDate: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  onChangeDate: (value: string) => void;
  onChangeWindow: (start: string, end: string) => void;
  testID?: string;
}

/** Fecha (YYYY-MM-DD, formato nativo de `<input type="date">`/`TextInput` con máscara
 * simple) + franja horaria de retiro en 3 opciones fijas — el backend valida que
 * `pickupTimeWindowEnd > pickupTimeWindowStart` y que la ventana no esté en el pasado
 * (`shipments.service.ts`, MOVO-80), acá solo se ofrecen ventanas ya válidas entre sí. */
export function TimeWindowPicker({
  pickupDate,
  timeWindowStart,
  timeWindowEnd,
  onChangeDate,
  onChangeWindow,
  testID,
}: TimeWindowPickerProps) {
  const colors = useThemeColors();

  return (
    <View testID={testID} className="gap-2.5">
      <TextInput
        testID={testID ? `${testID}-date` : undefined}
        value={pickupDate}
        onChangeText={onChangeDate}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.fg3}
        className="rounded-lg border border-border-strong px-3.5 py-3 font-sans text-body text-fg"
      />
      <View className="flex-row gap-2">
        {TIME_WINDOWS.map((w) => {
          const selected = w.start === timeWindowStart && w.end === timeWindowEnd;
          return (
            <Pressable
              key={w.label}
              testID={testID ? `${testID}-window-${w.start}` : undefined}
              onPress={() => onChangeWindow(w.start, w.end)}
              className={`flex-1 items-center rounded-lg border py-2.5 ${
                selected ? "border-fg bg-fg" : "border-border-strong bg-bg"
              }`}
            >
              <Text
                className={`font-sans-medium text-[11px] ${
                  selected ? "text-white dark:text-ink-950" : "text-fg"
                }`}
              >
                {w.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
