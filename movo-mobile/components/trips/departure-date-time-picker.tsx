import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { Calendar, Clock } from "lucide-react-native";
import { Platform, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
});

function combineDateAndTime(date: Date, time: Date): Date {
  const combined = new Date(date);
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined;
}

interface DepartureDateTimePickerProps {
  value: Date;
  onChange: (value: Date) => void;
  testID?: string;
}

/**
 * Fecha + hora de salida de un viaje declarado (MOVO-162, AC1) — a diferencia de
 * `TimeWindowPicker` (fecha + una de 3 franjas fijas, pensado para la ventana de
 * retiro de un envío), acá se necesita un instante único real: `departureAt` viaja
 * al backend como `date-time` ISO completo (`new Date(body.departureAt)` en
 * `trips.routes.ts`, `movo-svc-shipments`), no una fecha de calendario suelta — por
 * eso se trabaja con objetos `Date` reales de punta a punta, sin el gotcha de
 * timezone que sí aplica a `pickupDate`/`pickupTimeWindowStart` (fechas ancladas a
 * UTC, ver CLAUDE.md de `svc-shipments`/MOVO-80).
 *
 * Mismo patrón nativo que `TimeWindowPicker`: Android abre el diálogo imperativo
 * (`DateTimePickerAndroid.open`, el patrón recomendado por el propio paquete — montar
 * `<DateTimePicker>` ahí renderiza un calendario siempre visible en vez de un
 * diálogo), iOS usa `display="compact"` inline sin estado de visibilidad propio.
 */
export function DepartureDateTimePicker({
  value,
  onChange,
  testID,
}: DepartureDateTimePickerProps) {
  const colors = useThemeColors();
  const minimumDate = new Date();

  const openAndroidDate = () => {
    DateTimePickerAndroid.open({
      value,
      mode: "date",
      minimumDate,
      onChange: (event, selected) => {
        if (event.type === "set" && selected) onChange(combineDateAndTime(selected, value));
      },
    });
  };

  const openAndroidTime = () => {
    DateTimePickerAndroid.open({
      value,
      mode: "time",
      onChange: (event, selected) => {
        if (event.type === "set" && selected) onChange(combineDateAndTime(value, selected));
      },
    });
  };

  return (
    <View testID={testID} className="flex-row gap-2.5">
      <View className="flex-1">
        {Platform.OS === "android" ? (
          <Pressable
            testID={testID ? `${testID}-date` : undefined}
            onPress={openAndroidDate}
            className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-3"
          >
            <Calendar size={16} color={colors.fg3} strokeWidth={2} />
            <Text className="font-sans text-body text-fg">{DATE_FORMATTER.format(value)}</Text>
          </Pressable>
        ) : (
          <View className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-2">
            <Calendar size={16} color={colors.fg3} strokeWidth={2} />
            <Text className="flex-1 font-sans text-body text-fg" numberOfLines={1}>
              {DATE_FORMATTER.format(value)}
            </Text>
            <DateTimePicker
              testID={testID ? `${testID}-date` : undefined}
              value={value}
              mode="date"
              display="compact"
              minimumDate={minimumDate}
              onChange={(event, selected) => {
                if (event.type === "set" && selected) onChange(combineDateAndTime(selected, value));
              }}
            />
          </View>
        )}
      </View>

      <View className="flex-1">
        {Platform.OS === "android" ? (
          <Pressable
            testID={testID ? `${testID}-time` : undefined}
            onPress={openAndroidTime}
            className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-3"
          >
            <Clock size={16} color={colors.fg3} strokeWidth={2} />
            <Text className="font-sans text-body text-fg">{TIME_FORMATTER.format(value)}</Text>
          </Pressable>
        ) : (
          <View className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-2">
            <Clock size={16} color={colors.fg3} strokeWidth={2} />
            <Text className="flex-1 font-sans text-body text-fg" numberOfLines={1}>
              {TIME_FORMATTER.format(value)}
            </Text>
            <DateTimePicker
              testID={testID ? `${testID}-time` : undefined}
              value={value}
              mode="time"
              display="compact"
              onChange={(event, selected) => {
                if (event.type === "set" && selected) onChange(combineDateAndTime(value, selected));
              }}
            />
          </View>
        )}
      </View>
    </View>
  );
}
