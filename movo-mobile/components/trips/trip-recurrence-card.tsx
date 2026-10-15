import { argentinaWeekday } from "@movo/shared/dist/config/trip-recurrence";
import { Repeat } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  WEEKDAY_CHIPS,
  minimumUntilDate,
  recurrencePreview,
  sortWeekdays,
  toUntilDateString,
} from "../../src/lib/trip-recurrence";
import { ToggleSwitch } from "../ui/toggle-switch";
import { DepartureDateTimePicker } from "./departure-date-time-picker";

export type RecurrenceUntilMode = "none" | "date";

function FieldLabel({ children }: { children: string }) {
  return <Text className="font-sans-medium text-[13px] text-fg-2">{children}</Text>;
}

function RadioRow({
  label,
  selected,
  disabled,
  onPress,
  testID,
  children,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
  children?: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      className="min-h-[48px] flex-row items-center gap-3 px-3.5 py-2.5"
    >
      <View
        className={`h-5 w-5 items-center justify-center rounded-full ${
          selected ? "border-[1.5px] border-fg" : "border-[1.5px] border-border-strong"
        }`}
      >
        {selected ? <View className="h-2.5 w-2.5 rounded-full bg-fg" /> : null}
      </View>
      <Text className="flex-1 font-sans text-[15px] text-fg">{label}</Text>
      {children}
    </Pressable>
  );
}

interface TripRecurrenceCardProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  departureAt: Date;
  onDepartureChange: (value: Date) => void;
  weekdays: number[];
  onWeekdaysChange: (weekdays: number[]) => void;
  untilMode: RecurrenceUntilMode;
  onUntilModeChange: (mode: RecurrenceUntilMode) => void;
  until: Date;
  onUntilChange: (value: Date) => void;
  /** "Hasta" no es posterior a la primera salida. */
  untilInvalid?: boolean;
  /** La recurrencia no se puede tocar acá (el viaje ya tiene el siguiente declarado). */
  readOnlyReason?: string | null;
  /** Error de API que corresponde a este bloque (409 `RECURRING_SERIES_LIMIT`). */
  error?: string | null;
  testID?: string;
}

/**
 * Bloque "Se repite" de declarar/editar viaje (MOVO-266, AC1/AC2), traducido del
 * artefacto de Claude Design: switch con ícono `Repeat`; prendido, adentro van los chips
 * de días, "Hora de salida" + "Desde" (la primera salida concreta, el mismo `departureAt`
 * de siempre), "Hasta" y el preview lima.
 *
 * El chip del día de "Desde" queda fijo (el backend exige que esté incluido). Cada chip
 * mapea a `RECURRENCE_WEEKDAY` de `@movo/shared` (0 = domingo), nunca a su posición.
 */
export function TripRecurrenceCard({
  enabled,
  onToggle,
  departureAt,
  onDepartureChange,
  weekdays,
  onWeekdaysChange,
  untilMode,
  onUntilModeChange,
  until,
  onUntilChange,
  untilInvalid = false,
  readOnlyReason = null,
  error = null,
  testID,
}: TripRecurrenceCardProps) {
  const colors = useThemeColors();
  const readOnly = readOnlyReason !== null;
  const fixedDay = argentinaWeekday(departureAt);
  const id = (suffix: string) => (testID ? `${testID}-${suffix}` : undefined);

  const toggleDay = (day: number) => {
    if (readOnly || day === fixedDay) return;
    onWeekdaysChange(
      weekdays.includes(day) ? weekdays.filter((d) => d !== day) : sortWeekdays([...weekdays, day]),
    );
  };

  return (
    <View
      testID={testID}
      className={`overflow-hidden rounded-[10px] border ${enabled ? "border-fg" : "border-border"}`}
    >
      <Pressable
        testID={id("toggle-row")}
        onPress={() => !readOnly && onToggle(!enabled)}
        disabled={readOnly}
        className="flex-row items-center gap-3 p-3.5"
      >
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-ink-100 dark:bg-bg-mute">
          <Repeat size={18} color={colors.fg1} strokeWidth={2} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-sans-semibold text-[15px] text-fg">Se repite</Text>
          <Text className="font-sans text-[12px] text-fg-3">Publicá el mismo viaje todas las semanas</Text>
        </View>
        <ToggleSwitch testID={id("toggle")} value={enabled} onChange={onToggle} disabled={readOnly} />
      </Pressable>

      {readOnly ? (
        <Text testID={id("read-only")} className="px-3.5 pb-3.5 font-sans text-[12.5px] leading-[18px] text-fg-3">
          {readOnlyReason}
        </Text>
      ) : null}

      {enabled ? (
        <View className="gap-[18px] border-t border-border px-3.5 pb-4 pt-4">
          <View className="gap-2.5">
            <FieldLabel>Días</FieldLabel>
            <View className="flex-row justify-between">
              {WEEKDAY_CHIPS.map((chip) => {
                const selected = weekdays.includes(chip.value);
                const fixed = chip.value === fixedDay;
                return (
                  <Pressable
                    key={chip.value}
                    testID={id(`day-${chip.value}`)}
                    onPress={() => toggleDay(chip.value)}
                    disabled={readOnly || fixed}
                    accessibilityRole="checkbox"
                    accessibilityLabel={chip.name}
                    accessibilityState={{ checked: selected, disabled: readOnly || fixed }}
                    className={`h-10 w-10 items-center justify-center rounded-full ${
                      selected
                        ? "border-[1.5px] border-ink-950 bg-lime-500"
                        : "bg-ink-100 dark:bg-bg-mute"
                    }`}
                  >
                    <Text
                      className={`font-sans-semibold text-[14px] ${selected ? "text-ink-950" : "text-fg"}`}
                    >
                      {chip.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="flex-row gap-2.5">
            <View className="flex-1 gap-2">
              <FieldLabel>Hora de salida</FieldLabel>
              <DepartureDateTimePicker
                testID={id("time")}
                fields="time"
                value={departureAt}
                onChange={onDepartureChange}
                disabled={readOnly}
              />
            </View>
            <View className="flex-1 gap-2">
              <FieldLabel>Desde</FieldLabel>
              <DepartureDateTimePicker
                testID={id("from")}
                fields="date"
                value={departureAt}
                onChange={onDepartureChange}
                disabled={readOnly}
              />
            </View>
          </View>

          <View className="gap-2">
            <FieldLabel>Hasta</FieldLabel>
            <View className="rounded-[10px] border border-border">
              <RadioRow
                testID={id("until-none")}
                label="Sin fecha de fin"
                selected={untilMode === "none"}
                disabled={readOnly}
                onPress={() => onUntilModeChange("none")}
              />
              <View className="ml-[46px] h-px bg-border" />
              <RadioRow
                testID={id("until-date")}
                label="Hasta una fecha"
                selected={untilMode === "date"}
                disabled={readOnly}
                onPress={() => onUntilModeChange("date")}
              >
                {untilMode === "date" ? (
                  <View className="w-[150px]">
                    <DepartureDateTimePicker
                      testID={id("until-picker")}
                      fields="date"
                      value={until}
                      onChange={onUntilChange}
                      minimumDate={minimumUntilDate(departureAt)}
                      disabled={readOnly}
                    />
                  </View>
                ) : null}
              </RadioRow>
            </View>
            {untilInvalid ? (
              <Text testID={id("until-error")} className="font-sans text-[12px] text-danger-500">
                La fecha de fin tiene que ser posterior a la primera salida.
              </Text>
            ) : null}
          </View>

          <View testID={id("preview")} className="flex-row gap-2.5 rounded-lg bg-lime-200 px-3.5 py-3">
            <View className="pt-0.5">
              <Repeat size={14} color="#0A0A0B" strokeWidth={2} />
            </View>
            <Text className="flex-1 font-sans text-[13px] leading-[19.5px] text-ink-900">
              {recurrencePreview({
                departureAt,
                weekdays,
                until: untilMode === "date" ? toUntilDateString(until) : null,
              })}
            </Text>
          </View>
        </View>
      ) : null}

      {error ? (
        <Text testID={id("error")} className="px-3.5 pb-3.5 font-sans text-[12.5px] leading-[18px] text-danger-500">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
