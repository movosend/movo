import { EyeOff, Route, X, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PackageType } from "../../src/store/shipment-wizard-store";
import { packageTypeLabel } from "../send/category-grid";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatPriceArs } from "../../src/lib/shipment-format";

export const ON_TRIP_MAX_DETOUR_KM = 2;

export interface TransportFilters {
  onlyOnTrip: boolean;
  hideOffered: boolean;
  types: PackageType[];
  minPayArs: number;
  maxWeightKg: number;
}

export const DEFAULT_TRANSPORT_FILTERS: TransportFilters = {
  onlyOnTrip: false,
  hideOffered: false,
  types: [],
  minPayArs: 0,
  maxWeightKg: 0,
};

export function transportFilterCount(filters: TransportFilters): number {
  return (
    (filters.onlyOnTrip ? 1 : 0) +
    (filters.hideOffered ? 1 : 0) +
    (filters.types.length > 0 ? 1 : 0) +
    (filters.minPayArs > 0 ? 1 : 0) +
    (filters.maxWeightKg > 0 ? 1 : 0)
  );
}

const PACKAGE_TYPES: PackageType[] = ["letter_document", "standard_package", "fragile_item"];
const MIN_PAY_OPTIONS = [0, 2500, 4000, 6000];
const MAX_WEIGHT_OPTIONS = [0, 1, 5, 15];

function Chip({
  selected,
  label,
  onPress,
  testID,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className={`items-center rounded-full border px-2.5 py-2 ${selected ? "border-fg bg-fg" : "border-border-strong bg-bg"}`}
    >
      <Text
        numberOfLines={1}
        className={`font-sans-medium text-[12.5px] ${selected ? "text-bg" : "text-fg-2"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Fila de toggle genérica (ícono + título/subtítulo + switch) — reusada por "me
 * queda de paso" y "ocultar ya ofertados", antes duplicada a mano entre ambas. */
function ToggleRow({
  icon: Icon,
  title,
  subtitle,
  value,
  onToggle,
  testID,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      className={`flex-row items-center gap-3 rounded-md border p-4 ${
        value ? "border-lime-500/70 bg-lime-200/40" : "border-border"
      }`}
    >
      <Icon size={18} strokeWidth={1.8} color={colors.fg1} />
      <View className="flex-1">
        <Text className="font-sans-semibold text-[14px] text-fg">{title}</Text>
        <Text className="mt-0.5 font-sans text-[12px] text-fg-2">{subtitle}</Text>
      </View>
      <Pressable
        testID={testID}
        onPress={onToggle}
        className={`h-6 w-[42px] justify-center rounded-full px-0.5 ${value ? "bg-fg items-end" : "bg-bg-mute items-start"}`}
      >
        <View className="h-[18px] w-[18px] rounded-full bg-white shadow" />
      </Pressable>
    </View>
  );
}

/**
 * Hoja de filtros del tab "Transportar" (MOVO-183) — todo lo que no es radio ni
 * ordenamiento (que quedan siempre visibles) vive acá: "solo lo que me queda de
 * paso" (aproximación client-side de `computeOnTripDetour`, ver `shipment-format.ts`
 * — no hay endpoint que cruce el feed general contra los viajes activos), tipo de
 * paquete (multi-selección), pago mínimo y peso máximo (single-selección cada uno).
 * Sin soporte server-side para ninguno de estos 4 filtros (`GET /shipments/available`/
 * `GET /trips/:id/matches` no los aceptan como parámetro) — se aplican client-side
 * sobre las páginas ya cargadas, mismo criterio ya aceptado en "Mis Envíos"
 * (`app/(app)/shipments/index.tsx`, MOVO-113).
 */
export function TransportFiltersSheet({
  visible,
  onClose,
  applied,
  matchCount,
  showOnlyOnTrip,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  applied: TransportFilters;
  /** Cuántos envíos quedarían con el borrador actual — para el label del botón
   * primario ("Ver 3 envíos" / "Sin resultados"). */
  matchCount: (draft: TransportFilters) => number;
  /** Si hay al menos un viaje activo declarado — sin viajes, el toggle "me queda de
   * paso" no tiene nada contra qué cruzar y se oculta en vez de ofrecer un control
   * que nunca puede prender nada. */
  showOnlyOnTrip: boolean;
  onApply: (filters: TransportFilters) => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  const [draft, setDraft] = useState<TransportFilters>(applied);

  useEffect(() => {
    if (visible) setDraft(applied);
  }, [visible, applied]);

  const toggleType = (type: PackageType) => {
    setDraft((prev) => ({
      ...prev,
      types: prev.types.includes(type) ? prev.types.filter((t) => t !== type) : [...prev.types, type],
    }));
  };

  const count = matchCount(draft);
  const draftCount = transportFilterCount(draft);

  return (
    <Modal visible={isMounted} animationType="none" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, backdropStyle]}>
          <Pressable testID="transport-filters-backdrop" className="flex-1 bg-black/40" onPress={onClose} />
        </Animated.View>

        <Animated.View style={[sheetStyle, { maxHeight: "85%" }]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ maxHeight: "100%" }}
          >
            <View
              className="overflow-hidden rounded-t-3xl bg-bg pt-4"
              style={{ paddingBottom: insets.bottom + 16 }}
            >
              <View className="flex-row items-start justify-between gap-3 px-5">
                <View>
                  <Text className="font-sans-semibold text-h2 text-fg">Filtros</Text>
                  <Text className="mt-0.5 font-sans text-small text-fg-2">
                    {draftCount === 0
                      ? "Sin filtros aplicados"
                      : `${draftCount} ${draftCount === 1 ? "filtro activo" : "filtros activos"}`}
                  </Text>
                </View>
                <Pressable
                  testID="transport-filters-close"
                  onPress={onClose}
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
                >
                  <X size={16} color={colors.fg1} strokeWidth={2} />
                </Pressable>
              </View>

              <ScrollView
                style={{ flexShrink: 1 }}
                className="px-5"
                contentContainerStyle={{ paddingBottom: 4 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
              <View className="mt-7 gap-3.5">
                {showOnlyOnTrip ? (
                  <ToggleRow
                    testID="transport-filters-only-on-trip"
                    icon={Route}
                    title="Solo lo que me queda de paso"
                    subtitle={`Desvío de hasta ${ON_TRIP_MAX_DETOUR_KM} km sobre mis viajes`}
                    value={draft.onlyOnTrip}
                    onToggle={() => setDraft((prev) => ({ ...prev, onlyOnTrip: !prev.onlyOnTrip }))}
                  />
                ) : null}
                <ToggleRow
                  testID="transport-filters-hide-offered"
                  icon={EyeOff}
                  title="Ocultar ya ofertados"
                  subtitle="Sacá de la lista los envíos en los que ya hiciste una oferta"
                  value={draft.hideOffered}
                  onToggle={() => setDraft((prev) => ({ ...prev, hideOffered: !prev.hideOffered }))}
                />
              </View>

              <Text className="mb-3.5 mt-7 font-sans-semibold text-caption uppercase text-fg-2">Tipo de paquete</Text>
              <View className="flex-row flex-wrap gap-2.5">
                {PACKAGE_TYPES.map((type) => (
                  <Chip
                    key={type}
                    testID={`transport-filters-type-${type}`}
                    label={packageTypeLabel(type)}
                    selected={draft.types.includes(type)}
                    onPress={() => toggleType(type)}
                  />
                ))}
              </View>

              <View className="mt-7 flex-row items-baseline justify-between">
                <Text className="font-sans-semibold text-caption uppercase text-fg-2">Pago mínimo</Text>
                <Text className="font-mono text-[13px] font-semibold text-fg">
                  {draft.minPayArs === 0 ? "sin mínimo" : formatPriceArs(draft.minPayArs)}
                </Text>
              </View>
              <View className="mt-3.5 flex-row gap-2">
                {MIN_PAY_OPTIONS.map((value) => (
                  <View key={value} className="flex-1">
                    <Chip
                      testID={`transport-filters-min-pay-${value}`}
                      label={value === 0 ? "Cualquiera" : formatPriceArs(value)}
                      selected={draft.minPayArs === value}
                      onPress={() => setDraft((prev) => ({ ...prev, minPayArs: value }))}
                    />
                  </View>
                ))}
              </View>

              <View className="mt-7 flex-row items-baseline justify-between">
                <Text className="font-sans-semibold text-caption uppercase text-fg-2">Peso máximo</Text>
                <Text className="font-mono text-[13px] font-semibold text-fg">
                  {draft.maxWeightKg === 0 ? "sin límite" : `hasta ${draft.maxWeightKg} kg`}
                </Text>
              </View>
              <View className="mt-3.5 flex-row gap-2">
                {MAX_WEIGHT_OPTIONS.map((value) => (
                  <View key={value} className="flex-1">
                    <Chip
                      testID={`transport-filters-max-weight-${value}`}
                      label={value === 0 ? "Cualquiera" : `hasta ${value} kg`}
                      selected={draft.maxWeightKg === value}
                      onPress={() => setDraft((prev) => ({ ...prev, maxWeightKg: value }))}
                    />
                  </View>
                ))}
              </View>
              </ScrollView>

              <View className="mt-6 flex-row gap-2.5 px-5 pt-5 border-t border-border">
                <Pressable
                  testID="transport-filters-clear"
                  onPress={() => setDraft(DEFAULT_TRANSPORT_FILTERS)}
                  className="items-center justify-center rounded-lg border border-border-strong bg-bg px-7 py-4"
                >
                  <Text className="font-sans-semibold text-body text-fg">Limpiar</Text>
                </Pressable>
                <Pressable
                  testID="transport-filters-apply"
                  onPress={() => {
                    onApply(draft);
                    onClose();
                  }}
                  className="flex-1 items-center justify-center rounded-lg bg-fg py-4"
                >
                  <Text className="font-sans-semibold text-body text-bg">
                    {count > 0 ? `Ver ${count} ${count === 1 ? "envío" : "envíos"}` : "Sin resultados"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}
