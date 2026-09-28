import { ArrowDownLeft, ArrowUpRight, SlidersHorizontal, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { MyShipmentRole, MyShipmentsStage } from "../../src/lib/my-shipments-format";

/** Controles de la cabecera de "Mis envíos" (MOVO-257, prototipo "Mis envíos 4a"). */

/** Acceso por rol: tocarlo filtra la lista por ese rol, tocarlo de nuevo vuelve a
 * "todos". El punto avisa que alguno de ese rol espera algo del usuario. */
export function MyShipmentsRoleCard({
  role,
  selected,
  countLabel,
  needsAction,
  onPress,
}: {
  role: MyShipmentRole;
  selected: boolean;
  countLabel: string;
  needsAction: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const sending = role === "sending";
  const Icon = sending ? ArrowUpRight : ArrowDownLeft;
  return (
    <Pressable
      testID={`my-shipments-role-${role}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`flex-1 gap-2.5 rounded-[10px] border bg-bg-sub p-3.5 ${selected ? "border-fg" : "border-border"}`}
    >
      <View className="flex-row items-center justify-between">
        <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-bg-mute">
          <Icon size={16} strokeWidth={2} color={colors.fg1} />
        </View>
        {needsAction ? (
          <View testID={`my-shipments-role-${role}-dot`} className="h-2 w-2 rounded-full bg-fg" />
        ) : null}
      </View>
      <View>
        <Text className="font-sans-semibold text-[16px] text-fg">{sending ? "Enviás" : "Recibís"}</Text>
        <Text className="font-sans text-[13px] text-fg-3">{countLabel}</Text>
      </View>
    </Pressable>
  );
}

const STAGE_LABEL: Record<MyShipmentsStage, string> = { ongoing: "En curso", history: "Historial" };

export function MyShipmentsStageSelector({
  stage,
  onChange,
}: {
  stage: MyShipmentsStage;
  onChange: (stage: MyShipmentsStage) => void;
}) {
  return (
    <View className="flex-1 flex-row rounded-full bg-bg-mute p-1">
      {(Object.keys(STAGE_LABEL) as MyShipmentsStage[]).map((s) => {
        const active = s === stage;
        return (
          <Pressable
            key={s}
            testID={`my-shipments-stage-${s}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(s)}
            className={`h-[38px] flex-1 items-center justify-center rounded-full ${active ? "bg-fg" : ""}`}
          >
            <Text className={`font-sans-medium text-[15px] ${active ? "text-bg" : "text-fg"}`}>
              {STAGE_LABEL[s]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Abre la hoja de filtros (Estado y Persona). No está en el prototipo: se agrega al
 * lado del selector para no perder los filtros que ya existían. */
export function MyShipmentsFilterButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID="my-shipments-filter-open"
      accessibilityLabel="Filtrar envíos"
      onPress={onPress}
      className="h-[46px] w-[46px] items-center justify-center rounded-full bg-bg-mute"
    >
      <SlidersHorizontal size={18} strokeWidth={2} color={colors.fg1} />
      {active ? (
        <View testID="my-shipments-filter-dot" className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-fg" />
      ) : null}
    </Pressable>
  );
}

/** Filtros aplicados, visibles siempre y removibles con un toque sin abrir la hoja. */
export function MyShipmentsActiveFilters({
  chips,
}: {
  chips: Array<{ id: string; label: string; onRemove: () => void }>;
}) {
  const colors = useThemeColors();
  if (chips.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-2 px-5 pt-2">
      {chips.map((chip) => (
        <Pressable
          key={chip.id}
          testID={`my-shipments-active-filter-${chip.id}`}
          accessibilityLabel={`Quitar filtro ${chip.label}`}
          onPress={chip.onRemove}
          className="h-8 flex-row items-center gap-1.5 rounded-full bg-bg-mute pl-3 pr-2.5"
        >
          <Text numberOfLines={1} className="font-sans-medium text-[13px] text-fg">
            {chip.label}
          </Text>
          <X size={14} strokeWidth={2} color={colors.fg2} />
        </Pressable>
      ))}
    </View>
  );
}
