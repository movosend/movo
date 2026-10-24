import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { Calendar } from "lucide-react-native";
import { Platform, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  availableWindowsFor,
  pickerValueToPickupDate,
  pickupDateToPickerValue,
  PICKUP_TIME_WINDOWS,
  todayInArgentina,
} from "../../src/lib/pickup-windows";
import { formatPickupDateLabel } from "../../src/lib/shipment-format";
import { formatTimeRange } from "../../src/lib/time-format";

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
  // MOVO-340: selector controlado — lo que se ve elegido sale solo de `pickupDate` (el
  // wizard lo inicializa con `defaultPickupDate`), sin un "hoy" visual propio que el
  // formulario no tenía cargado.
  const today = todayInArgentina();
  const selectedDate = pickupDate || today;
  const dateValue = pickupDateToPickerValue(selectedDate);
  const displayDate = formatPickupDateLabel(pickupDate);
  const minimumDate = pickupDateToPickerValue(today);
  const available = availableWindowsFor(selectedDate);
  const isAvailable = (w: { start: string; end: string }) =>
    available.some((a) => a.start === w.start && a.end === w.end);

  const handleAndroidPress = () => {
    DateTimePickerAndroid.open({
      value: dateValue,
      mode: "date",
      minimumDate,
      onChange: (event, selectedDate) => {
        if (event.type === "set" && selectedDate)
          onChangeDate(pickerValueToPickupDate(selectedDate));
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
                onChangeDate(pickerValueToPickupDate(selectedDate));
            }}
          />
        </View>
      )}
      <View className="flex-row gap-2">
        {PICKUP_TIME_WINDOWS.map((w) => {
          const selected =
            w.start === timeWindowStart && w.end === timeWindowEnd;
          // MOVO-340: una franja de hoy que ya empezó no se puede elegir (el backend la rechaza).
          const disabled = !isAvailable(w);
          return (
            <Pressable
              key={w.start}
              testID={testID ? `${testID}-window-${w.start}` : undefined}
              onPress={() => onChangeWindow(w.start, w.end)}
              disabled={disabled}
              accessibilityState={{ disabled, selected }}
              className={`flex-1 items-center rounded-lg border py-2.5 ${
                selected ? "border-fg bg-fg" : "border-border-strong bg-bg"
              } ${disabled ? "opacity-40" : ""}`}
            >
              <Text
                className={`font-sans-medium text-[11px] ${selected ? "text-white dark:text-ink-950" : "text-fg"}`}
              >
                {formatTimeRange(w.start, w.end)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
