import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import type { TransactionRole, TransactionStatus } from "@movo/shared/dist/types/transaction";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { EMPTY_TRANSACTION_FILTERS, type TransactionFilters } from "../../src/hooks/use-transactions";
import {
  DATE_PRESETS,
  dateRangeForPreset,
  dayStringToPickerDate,
  formatFilterDay,
  matchingDatePreset,
  pickerDateToDayString,
  todayInArgentina,
  TRANSACTION_STATUS_ORDER,
  transactionStatusLabel,
} from "../../src/lib/transaction-format";

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`h-10 justify-center rounded-full border px-3.5 ${selected ? "border-fg bg-fg" : "border-border-strong bg-bg"}`}
    >
      <Text className={`font-sans-medium text-[14px] ${selected ? "text-bg" : "text-fg"}`}>{label}</Text>
    </Pressable>
  );
}

type DateField = "from" | "to";

function DateFieldButton({
  label,
  value,
  onPress,
  testID,
}: {
  label: string;
  value: string | null;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ? formatFilterDay(value) : "sin elegir"}`}
      onPress={onPress}
      className="h-14 flex-1 justify-center rounded-xl border border-border-strong bg-bg px-3"
    >
      <Text className="font-sans text-[11.5px] text-fg-3">{label}</Text>
      <Text className={`font-sans-semibold text-[15px] ${value ? "text-fg" : "text-fg-3"}`}>
        {value ? formatFilterDay(value) : "Elegir"}
      </Text>
    </Pressable>
  );
}

/**
 * Hoja de filtros del historial (MOVO-304 AC8, canvas "4 · Filtros"): estados en
 * multi-selección y fechas con los atajos "Últimos 30 días", "Este mes" y "Mes anterior" o
 * un rango manual desde/hasta. Trabaja sobre un borrador que recién se aplica con el botón.
 * Las fechas viajan como `YYYY-MM-DD` y las interpreta el backend en hora de Argentina (AC9):
 * acá no se convierte ningún huso, salvo para calcular los atajos sobre el día argentino.
 *
 * Android abre el diálogo nativo (`DateTimePickerAndroid.open`); iOS muestra el selector
 * `spinner` debajo de los campos mientras uno está en edición.
 */
export function TransactionFiltersSheet({
  visible,
  role,
  applied,
  onApply,
  onClose,
}: {
  visible: boolean;
  role: TransactionRole;
  applied: TransactionFilters;
  onApply: (filters: TransactionFilters) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  const [draft, setDraft] = useState<TransactionFilters>(applied);
  const [editing, setEditing] = useState<DateField | null>(null);

  useEffect(() => {
    if (visible) {
      setDraft(applied);
      setEditing(null);
    }
  }, [visible, applied]);

  const today = todayInArgentina();
  const activePreset = matchingDatePreset(draft.from, draft.to);

  const toggleStatus = (status: TransactionStatus) =>
    setDraft((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status],
    }));

  /** Si el desde pasa al hasta (o al revés) el otro extremo se alinea, así nunca queda un rango invertido. */
  const setDay = (field: DateField, day: string) =>
    setDraft((prev) => {
      if (field === "from") return { ...prev, from: day, to: prev.to && prev.to < day ? day : prev.to };
      return { ...prev, to: day, from: prev.from && prev.from > day ? day : prev.from };
    });

  const openField = (field: DateField) => {
    const current = draft[field] ?? today;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: dayStringToPickerDate(current),
        mode: "date",
        maximumDate: dayStringToPickerDate(today),
        onChange: (event, selected) => {
          if (event.type === "set" && selected) setDay(field, pickerDateToDayString(selected));
        },
      });
      return;
    }
    setEditing((prev) => (prev === field ? null : field));
  };

  return (
    <Modal visible={isMounted} animationType="none" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable testID="transaction-filters-backdrop" className="flex-1 bg-black/50" onPress={onClose} />
        </Animated.View>

        <Animated.View style={[sheetStyle, { maxHeight: "90%" }]}>
          <View
            accessibilityViewIsModal
            className="rounded-t-3xl bg-bg px-5 pt-2.5"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <View className="mb-3.5 h-1 w-10 self-center rounded-full bg-border-strong" />
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="font-sans-semibold text-[18px] text-fg">Filtros</Text>
              <Pressable
                testID="transaction-filters-clear"
                accessibilityRole="button"
                onPress={() => {
                  setDraft(EMPTY_TRANSACTION_FILTERS);
                  setEditing(null);
                }}
                hitSlop={8}
                className="px-1 py-3"
              >
                <Text className="font-sans-semibold text-[14px] text-fg-2">Limpiar</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
              <Text className="mb-2.5 font-sans-semibold text-caption uppercase text-fg-3">Estado</Text>
              <View className="flex-row flex-wrap gap-2">
                <Chip
                  testID="transaction-filters-status-all"
                  label="Todos"
                  selected={draft.statuses.length === 0}
                  onPress={() => setDraft((prev) => ({ ...prev, statuses: [] }))}
                />
                {TRANSACTION_STATUS_ORDER.map((status) => (
                  <Chip
                    key={status}
                    testID={`transaction-filters-status-${status}`}
                    label={transactionStatusLabel(status, role)}
                    selected={draft.statuses.includes(status)}
                    onPress={() => toggleStatus(status)}
                  />
                ))}
              </View>

              <Text className="mb-2.5 mt-5 font-sans-semibold text-caption uppercase text-fg-3">Fechas</Text>
              <View className="mb-3 flex-row flex-wrap gap-2">
                {DATE_PRESETS.map((preset) => (
                  <Chip
                    key={preset.id}
                    testID={`transaction-filters-preset-${preset.id}`}
                    label={preset.label}
                    selected={activePreset === preset.id}
                    onPress={() => {
                      const range = dateRangeForPreset(preset.id);
                      setDraft((prev) => ({ ...prev, ...range }));
                      setEditing(null);
                    }}
                  />
                ))}
              </View>
              <View className="flex-row gap-2.5">
                <DateFieldButton
                  testID="transaction-filters-from"
                  label="Desde"
                  value={draft.from}
                  onPress={() => openField("from")}
                />
                <DateFieldButton
                  testID="transaction-filters-to"
                  label="Hasta"
                  value={draft.to}
                  onPress={() => openField("to")}
                />
              </View>
              {Platform.OS === "ios" && editing ? (
                <View className="items-center pt-1">
                  <DateTimePicker
                    testID="transaction-filters-picker"
                    value={dayStringToPickerDate(draft[editing] ?? today)}
                    mode="date"
                    display="spinner"
                    maximumDate={dayStringToPickerDate(today)}
                    onChange={(_event, selected) => {
                      if (selected) setDay(editing, pickerDateToDayString(selected));
                    }}
                    style={{ width: "100%" }}
                  />
                </View>
              ) : null}
              <Text className="mt-2.5 font-sans text-[12.5px] leading-[17px] text-fg-2">
                Las fechas se toman en hora de Argentina: un pago de las 23:30 queda en su día.
              </Text>
            </ScrollView>

            <Pressable
              testID="transaction-filters-apply"
              accessibilityRole="button"
              onPress={() => {
                onApply(draft);
                onClose();
              }}
              className="mt-[18px] h-[52px] items-center justify-center rounded-[14px] bg-lime-500 active:opacity-80"
            >
              <Text className="font-sans-semibold text-[16px] text-ink-950">Aplicar filtros</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
