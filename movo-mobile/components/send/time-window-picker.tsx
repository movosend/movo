import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { Calendar } from "lucide-react-native";
import { Platform, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatPickupDateLabel } from "../../src/lib/shipment-format";

const TIME_WINDOWS: { start: string; end: string; label: string }[] = [
  { start: "09:00", end: "12:00", label: "09:00 – 12:00" },
  { start: "12:00", end: "18:00", label: "12:00 – 18:00" },
  { start: "18:00", end: "22:00", label: "18:00 – 22:00" },
];

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function parsePickupDate(pickupDate: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    const [year, month, day] = pickupDate.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return startOfToday();
}

function formatPickupDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface TimeWindowPickerProps {
  pickupDate: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  onChangeDate: (value: string) => void;
  onChangeWindow: (start: string, end: string) => void;
  testID?: string;
}

/** Fecha de retiro (selector nativo — AC5) + franja horaria en 3 opciones fijas — el
 * backend valida que `pickupTimeWindowEnd > pickupTimeWindowStart` y que la ventana no
 * esté en el pasado (`shipments.service.ts`, MOVO-80); acá se previene directamente
 * eligiendo una fecha pasada (`minimumDate`) en vez de solo validarlo después.
 *
 * Android abre el diálogo nativo de forma imperativa (`DateTimePickerAndroid.open`) —
 * es el patrón recomendado por el propio paquete para ese SO, montar el componente
 * `<DateTimePicker>` ahí renderiza un calendario/spinner siempre visible en vez de un
 * diálogo. iOS usa `display="compact"`: un botón nativo que abre el calendario como
 * popover al tocarlo, sin necesitar estado de visibilidad propio. */
export function TimeWindowPicker({
  pickupDate,
  timeWindowStart,
  timeWindowEnd,
  onChangeDate,
  onChangeWindow,
  testID,
}: TimeWindowPickerProps) {
  const colors = useThemeColors();
  const dateValue = parsePickupDate(pickupDate);
  const displayDate = formatPickupDateLabel(pickupDate);
  const minimumDate = startOfToday();

  const handleAndroidPress = () => {
    DateTimePickerAndroid.open({
      value: dateValue,
      mode: "date",
      minimumDate,
      onChange: (event, selectedDate) => {
        if (event.type === "set" && selectedDate)
          onChangeDate(formatPickupDate(selectedDate));
      },
    });
  };

  return (
    <View testID={testID} className="gap-2.5">
      {Platform.OS === "android" ? (
        <Pressable
          testID={testID ? `${testID}-date` : undefined}
          onPress={handleAndroidPress}
          className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-3"
        >
          <Calendar size={16} color={colors.fg3} strokeWidth={2} />
          <Text
            className={`font-sans text-body ${displayDate ? "text-fg" : "text-fg-3"}`}
          >
            {displayDate ?? "Elegí una fecha"}
          </Text>
        </Pressable>
      ) : (
        <View className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-2">
          <Calendar size={16} color={colors.fg3} strokeWidth={2} />
          <Text
            className={`flex-1 font-sans text-body ${displayDate ? "text-fg" : "text-fg-3"}`}
          >
            {displayDate ?? "Elegí una fecha"}
          </Text>
          <DateTimePicker
            testID={testID ? `${testID}-date` : undefined}
            value={dateValue}
            mode="date"
            display="compact"
            minimumDate={minimumDate}
            onChange={(event, selectedDate) => {
              if (event.type === "set" && selectedDate)
                onChangeDate(formatPickupDate(selectedDate));
            }}
          />
        </View>
      )}
      <View className="flex-row gap-2">
        {TIME_WINDOWS.map((w) => {
          const selected =
            w.start === timeWindowStart && w.end === timeWindowEnd;
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
                className={`font-sans-medium text-[11px] ${selected ? "text-white dark:text-ink-950" : "text-fg"}`}
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
