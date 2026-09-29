import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type {
  MyShipmentPillTone,
  MyShipmentPresentation,
  MyShipmentStrip,
} from "../../src/lib/my-shipments-format";

/**
 * Filas de "Mis envíos" (MOVO-257), réplica del prototipo de Claude Design "Mis envíos
 * 4a". Los colores sin token en `tailwind.config.js` (lima "en vivo", verde de entregado,
 * rojo de cancelado, lima clara de la franja) van fijos como en el prototipo; el resto
 * usa los tokens semánticos para que funcione en modo oscuro.
 */

const PILL_STYLE: Record<Exclude<MyShipmentPillTone, "ink">, { bg: string; fg: string }> = {
  live: { bg: "#EEFCBF", fg: "#6E8E1E" },
  warning: { bg: "#FEF7E7", fg: "#A97714" },
  success: { bg: "rgba(43,182,115,0.12)", fg: "#1E7A4C" },
  danger: { bg: "rgba(229,72,77,0.1)", fg: "#B4282D" },
};

export function MyShipmentStatusPill({
  label,
  tone,
  testID,
}: {
  label: string;
  tone: MyShipmentPillTone;
  testID?: string;
}) {
  if (tone === "ink") {
    return (
      <View testID={testID} className="h-[22px] flex-row items-center rounded-full bg-fg px-[9px]">
        <Text className="font-sans-semibold text-[11px] tracking-[0.66px] text-bg">{label}</Text>
      </View>
    );
  }
  const { bg, fg } = PILL_STYLE[tone];
  return (
    <View
      testID={testID}
      className="h-[22px] flex-row items-center gap-1.5 rounded-full px-[9px]"
      style={{ backgroundColor: bg }}
    >
      {tone === "live" ? (
        <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: fg }} />
      ) : null}
      <Text className="font-sans-semibold text-[11px] tracking-[0.66px]" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

function RoleTag({ role }: { role: MyShipmentPresentation["role"] }) {
  const sending = role === "sending";
  const Icon = sending ? ArrowUpRight : ArrowDownLeft;
  const { bg, fg } = PILL_STYLE.live;
  return (
    <View
      className="h-[22px] flex-row items-center gap-1 rounded-full px-2"
      style={{ backgroundColor: bg }}
    >
      <Icon size={12} strokeWidth={2.4} color={fg} />
      <Text className="font-sans-semibold text-[11px] tracking-[0.66px]" style={{ color: fg }}>
        {sending ? "ENVIÁS" : "RECIBÍS"}
      </Text>
    </View>
  );
}

function ActionStrip({
  strip,
  onPress,
  testID,
}: {
  strip: MyShipmentStrip;
  onPress: () => void;
  testID?: string;
}) {
  const warning = strip.kind === "warning";
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className="flex-row items-center gap-2.5 rounded-[6px] border px-3.5 py-3"
      style={
        warning
          ? { backgroundColor: "#FEF7E7", borderColor: "#F9D888" }
          : { backgroundColor: "#F6FEDF", borderColor: "#D6F771" }
      }
    >
      <View
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: warning ? "#D69A1E" : "#0A0A0B" }}
      />
      <Text className="flex-1 font-sans-semibold text-[14px] leading-[19px] text-ink-950">{strip.text}</Text>
      <ChevronRight size={16} strokeWidth={2} color="#0A0A0B" />
    </Pressable>
  );
}

/** Fila de la pestaña "En curso". */
export function MyShipmentRow({
  presentation,
  showRoleTag,
  onPress,
  onStripPress,
  testID,
}: {
  presentation: MyShipmentPresentation;
  /** El prototipo muestra el tag de rol solo cuando no hay un rol filtrado. */
  showRoleTag: boolean;
  onPress: () => void;
  onStripPress: () => void;
  testID?: string;
}) {
  const { dayLabel, pill, quietStatus, title, price, priceCaption, strip, role } = presentation;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className="gap-3 border-b border-border px-5 py-4 active:bg-bg-sub"
    >
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1 gap-1.5">
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text className="font-sans text-[14px] text-fg-3">{dayLabel}</Text>
            {showRoleTag ? <RoleTag role={role} /> : null}
            {pill ? (
              <MyShipmentStatusPill
                label={pill.label}
                tone={pill.tone}
                testID={testID ? `${testID}-pill` : undefined}
              />
            ) : null}
            {quietStatus ? (
              <Text testID={testID ? `${testID}-quiet` : undefined} className="font-sans text-[14px] text-ink-400">
                · {quietStatus}
              </Text>
            ) : null}
          </View>
          <Text numberOfLines={1} className="font-sans-semibold text-[18px] tracking-[-0.18px] text-fg">
            {title}
          </Text>
        </View>
        <View className="items-end rounded-[10px] bg-bg-mute px-3 py-2">
          <Text className="font-sans-semibold text-[17px] tracking-[-0.17px] text-fg">{price}</Text>
          <Text className="font-sans text-[12px] text-fg-3">{priceCaption}</Text>
        </View>
      </View>
      {strip ? (
        <ActionStrip strip={strip} onPress={onStripPress} testID={testID ? `${testID}-strip` : undefined} />
      ) : null}
    </Pressable>
  );
}

/** Fila compacta de la pestaña "Historial". */
export function MyShipmentHistoryRow({
  presentation,
  onPress,
  testID,
}: {
  presentation: MyShipmentPresentation;
  onPress: () => void;
  testID?: string;
}) {
  const { dayLabel, role, title, pill, quietStatus } = presentation;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-border px-5 py-3.5 active:bg-bg-sub"
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-sans text-[14px] text-fg-3">
          {dayLabel} · {role === "sending" ? "Enviás" : "Recibís"}
        </Text>
        <Text numberOfLines={1} className="font-sans-semibold text-[17px] text-fg">
          {title}
        </Text>
      </View>
      {pill ? (
        <MyShipmentStatusPill label={pill.label} tone={pill.tone} testID={testID ? `${testID}-pill` : undefined} />
      ) : quietStatus ? (
        <Text className="font-sans text-[14px] text-ink-400">{quietStatus}</Text>
      ) : null}
    </Pressable>
  );
}
