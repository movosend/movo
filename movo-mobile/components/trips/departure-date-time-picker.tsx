import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { Calendar, Clock } from "lucide-react-native";
import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
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

type OpenField = "date" | "time" | null;

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
 * Android abre el diálogo imperativo (`DateTimePickerAndroid.open`, el patrón
 * recomendado por el propio paquete — montar `<DateTimePicker>` ahí renderiza un
 * calendario siempre visible en vez de un diálogo). El `Pressable` de todo el pill
 * dispara ese diálogo, así que el área de toque ya es el pill entero.
 *
 * iOS pasó por dos intentos antes de este: `display="compact"` inline (el widget
 * nativo, con dos campos a mitad de fila, quedaba con su chrome achicado y
 * superpuesto — "no se ven bien") y, después, ese mismo widget vuelto invisible
 * (`opacity` chico) superpuesto sobre un pill propio — mejoraba lo visual, pero el
 * área que de verdad reconoce el toque en ese control nativo es el tamaño intrínseco
 * de su propio widget compacto (chico, centrado), no el `100%` que le pide el
 * `style` absoluto que lo envuelve — así que solo una porción chica del pill abría el
 * selector (reportado por el usuario probando en dispositivo). Se resolvió con el
 * mismo patrón de sheet inferior que ya usa el resto del repo para triggers +
 * `Modal` (`select-field.tsx`, `useSheetAnimation`): el `Pressable` de todo el pill
 * abre una hoja con un `DateTimePicker` `display="spinner"` (visible y a ancho
 * completo ahí adentro, sin el problema de hit-area) + botón "Listo".
 */
export function DepartureDateTimePicker({
  value,
  onChange,
  testID,
}: DepartureDateTimePickerProps) {
  const colors = useThemeColors();
  const minimumDate = new Date();
  const [openField, setOpenField] = useState<OpenField>(null);
  const [draftValue, setDraftValue] = useState(value);
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(openField !== null);

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

  const openIosSheet = (field: "date" | "time") => {
    setDraftValue(value);
    setOpenField(field);
  };

  const closeIosSheet = () => setOpenField(null);

  const handleIosPickerChange = (_event: unknown, selected?: Date) => {
    if (!selected) return;
    const combined =
      openField === "date" ? combineDateAndTime(selected, value) : combineDateAndTime(value, selected);
    setDraftValue(combined);
    onChange(combined);
  };

  return (
    <View testID={testID} className="flex-row gap-2.5">
      <View className="flex-1">
        <Pressable
          testID={testID ? `${testID}-date` : undefined}
          onPress={Platform.OS === "android" ? openAndroidDate : () => openIosSheet("date")}
          className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-3"
        >
          <Calendar size={16} color={colors.fg3} strokeWidth={2} />
          <Text className="flex-1 font-sans text-body text-fg" numberOfLines={1}>
            {DATE_FORMATTER.format(value)}
          </Text>
        </Pressable>
      </View>

      <View className="flex-1">
        <Pressable
          testID={testID ? `${testID}-time` : undefined}
          onPress={Platform.OS === "android" ? openAndroidTime : () => openIosSheet("time")}
          className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-3"
        >
          <Clock size={16} color={colors.fg3} strokeWidth={2} />
          <Text className="flex-1 font-sans text-body text-fg" numberOfLines={1}>
            {TIME_FORMATTER.format(value)}
          </Text>
        </Pressable>
      </View>

      {Platform.OS === "ios" ? (
        <Modal
          visible={isMounted}
          animationType="none"
          transparent
          onRequestClose={closeIosSheet}
        >
          <View className="flex-1">
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
              <Pressable
                testID={testID ? `${testID}-sheet-backdrop` : undefined}
                className="flex-1 bg-black/40"
                onPress={closeIosSheet}
              />
            </Animated.View>
            <View className="flex-1 justify-end" pointerEvents="box-none">
              <Animated.View style={sheetStyle}>
                <View className="rounded-t-2xl bg-bg">
                  <SafeAreaView edges={["bottom"]}>
                    <View className="flex-row items-center justify-between border-b border-border-strong px-5 py-3.5">
                      <Text className="font-sans-medium text-[14px] text-fg">
                        {openField === "date" ? "Fecha de salida" : "Hora de salida"}
                      </Text>
                      <Pressable
                        testID={testID ? `${testID}-sheet-done` : undefined}
                        onPress={closeIosSheet}
                      >
                        <Text className="font-sans-semibold text-[14px] text-fg">Listo</Text>
                      </Pressable>
                    </View>
                    {openField ? (
                      <View className="items-center py-2">
                        <DateTimePicker
                          testID={testID ? `${testID}-sheet-picker` : undefined}
                          value={draftValue}
                          mode={openField}
                          display="spinner"
                          minimumDate={openField === "date" ? minimumDate : undefined}
                          onChange={handleIosPickerChange}
                          style={{ width: "100%" }}
                        />
                      </View>
                    ) : null}
                  </SafeAreaView>
                </View>
              </Animated.View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
