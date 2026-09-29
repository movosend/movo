import { Search } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface FilterOption {
  id: string;
  label: string;
}

/** Cuántas personas se ofrecen como pill sin buscar — más allá de eso, la fila deja de
 * leerse como un filtro y hay que escribir para llegar al resto. */
const TOP_PEOPLE_SHOWN = 3;
const ALL_OPTION_ID = "all";

/**
 * Pills de filtro con scroll horizontal (MOVO-127, referencia Uber "Activity"): todas
 * las opciones visibles de una, sin cambiar el alto de la hoja al elegir.
 */
function FilterPillRow({
  options,
  valueId,
  onChange,
  testID,
}: {
  options: FilterOption[];
  valueId: string;
  onChange: (id: string) => void;
  testID?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
    >
      {options.map((option) => {
        const selected = option.id === valueId;
        return (
          <Pressable
            key={option.id}
            testID={testID ? `${testID}-option-${option.id}` : undefined}
            onPress={() => onChange(option.id)}
            className={`rounded-full px-4 py-2.5 ${selected ? "bg-fg" : "bg-bg-mute"}`}
          >
            <Text
              numberOfLines={1}
              className={`font-sans-medium text-small ${selected ? "text-bg" : "text-fg"}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Hoja de filtros de "Mis envíos" (MOVO-257). El rol ya no vive acá — lo resuelven las
 * tarjetas "Enviás"/"Recibís" —, quedan Estado (con los mismos nombres que muestran las
 * filas) y Persona (la otra parte de cada envío: el receptor si enviás, el emisor si
 * recibís).
 */
export function MyShipmentsFilterSheet({
  visible,
  onClose,
  appliedStatus,
  appliedPerson,
  statusOptions,
  personOptions,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  appliedStatus: string | null;
  appliedPerson: string | null;
  statusOptions: FilterOption[];
  /** De la persona más frecuente a la menos. */
  personOptions: FilterOption[];
  onApply: (status: string | null, person: string | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const [draftStatus, setDraftStatus] = useState<string | null>(appliedStatus);
  const [draftPerson, setDraftPerson] = useState<string | null>(appliedPerson);
  const [query, setQuery] = useState("");
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  useEffect(() => {
    if (visible) {
      setDraftStatus(appliedStatus);
      setDraftPerson(appliedPerson);
      setQuery("");
    }
  }, [visible, appliedStatus, appliedPerson]);

  const normalizedQuery = query.trim().toLowerCase();
  const visiblePeople = normalizedQuery
    ? personOptions.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : personOptions.filter((option, index) => index < TOP_PEOPLE_SHOWN || option.id === draftPerson);
  const isDraftActive = draftStatus !== null || draftPerson !== null;

  return (
    <Modal visible={isMounted} animationType="none" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        {/* Overlay: solo hace fade (nunca se desliza) — ver `useSheetAnimation`. */}
        <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, backdropStyle]}>
          <Pressable testID="shipments-filter-backdrop" className="flex-1 bg-black/40" onPress={onClose} />
        </Animated.View>

        <Animated.View style={sheetStyle}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View className="rounded-t-3xl bg-bg" style={{ paddingBottom: insets.bottom + 16 }}>
              <View className="items-center border-b border-border px-5 pb-3.5 pt-4">
                <Text className="font-sans-semibold text-[17px] text-fg">Filtrar por…</Text>
                {isDraftActive ? (
                  <Text
                    testID="shipments-filter-clear"
                    onPress={() => {
                      setDraftStatus(null);
                      setDraftPerson(null);
                      setQuery("");
                    }}
                    className="absolute right-5 top-[18px] font-sans-medium text-small text-fg-2"
                  >
                    Limpiar
                  </Text>
                ) : null}
              </View>

              <View className="gap-2.5 pt-5">
                <Text className="px-5 font-sans-semibold text-[17px] text-fg">Estado</Text>
                <FilterPillRow
                  testID="shipments-filter-status"
                  options={[{ id: ALL_OPTION_ID, label: "Todos" }, ...statusOptions]}
                  valueId={draftStatus ?? ALL_OPTION_ID}
                  onChange={(id) => setDraftStatus(id === ALL_OPTION_ID ? null : id)}
                />
              </View>

              <View className="gap-2.5 pt-6">
                <Text className="px-5 font-sans-semibold text-[17px] text-fg">Persona</Text>
                <View className="px-5">
                  <View className="flex-row items-center gap-2 rounded-full bg-bg-mute px-3.5 py-2.5">
                    <Search size={16} color={colors.fg3} strokeWidth={2} />
                    <TextInput
                      testID="shipments-filter-person-search"
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Buscar persona"
                      placeholderTextColor={colors.fg3}
                      autoCorrect={false}
                      className="flex-1 p-0 font-sans text-small text-fg"
                    />
                  </View>
                </View>
                {normalizedQuery && visiblePeople.length === 0 ? (
                  <Text className="px-5 font-sans text-small text-fg-3">Sin resultados.</Text>
                ) : (
                  <FilterPillRow
                    testID="shipments-filter-person"
                    options={[{ id: ALL_OPTION_ID, label: "Todas" }, ...visiblePeople]}
                    valueId={draftPerson ?? ALL_OPTION_ID}
                    onChange={(id) => setDraftPerson(id === ALL_OPTION_ID ? null : id)}
                  />
                )}
              </View>

              <View className="px-5 pt-7">
                <Pressable
                  testID="shipments-filter-apply"
                  onPress={() => {
                    onApply(draftStatus, draftPerson);
                    onClose();
                  }}
                  className="w-full items-center rounded-full bg-fg py-4"
                >
                  <Text className="font-sans-semibold text-body text-bg">Aplicar</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}
