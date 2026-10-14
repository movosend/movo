import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";

export interface SafetyTarget {
  userId: string;
  name: string;
  blocked: boolean;
}

export interface ChatSafetySheetProps {
  visible: boolean;
  onClose: () => void;
  targets: SafetyTarget[];
  reported: boolean;
  busy: boolean;
  error?: string | null;
  onToggleBlock: (target: SafetyTarget) => void;
  onReport: () => void;
}

/** Rojo de "peligro" del prototipo (`danger: "#E5484D"`, igual en los dos temas). */
const DANGER = "#E5484D";

function OptionRow({
  testID,
  color,
  title,
  sub,
  disabled,
  onPress,
  icon,
}: {
  testID: string;
  color: string;
  title: string;
  sub: string;
  disabled?: boolean;
  onPress: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      className="flex-row items-center border border-border active:border-border-strong"
      style={{ gap: 12, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16 }}
    >
      {icon}
      <View className="flex-1">
        <Text className="font-sans-semibold text-body" style={{ color }}>
          {title}
        </Text>
        <Text className="font-sans text-small text-fg-3">{sub}</Text>
      </View>
    </Pressable>
  );
}

/** MOVO-284: hoja "Tu seguridad", calcada del prototipo (agarrador, título en mayúsculas, opciones con borde). */
export function ChatSafetySheet({ visible, onClose, targets, reported, busy, error, onToggleBlock, onReport }: ChatSafetySheetProps) {
  const colors = useThemeColors();
  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      testID="chat-safety-sheet"
      backdropTestID="chat-safety-backdrop"
      backdropClassName="bg-ink-950/50"
      sheetClassName="rounded-t-[24px] bg-bg"
      contentClassName="px-4 pt-2.5"
    >
      <View style={{ gap: 10, paddingBottom: 14 }}>
        <View className="self-center bg-border-strong" style={{ width: 40, height: 4, borderRadius: 2, marginBottom: 6 }} />
        <Text className="font-sans-semibold text-caption uppercase text-fg-3">Tu seguridad</Text>

        {error ? (
          <Text testID="chat-safety-error" className="font-sans text-small" style={{ color: DANGER }}>
            {error}
          </Text>
        ) : null}

        {targets.map((target) => {
          const color = target.blocked ? colors.fg1 : DANGER;
          return (
            <OptionRow
              key={target.userId}
              testID={`chat-safety-block-${target.userId}`}
              color={color}
              title={`${target.blocked ? "Desbloquear a" : "Bloquear a"} ${target.name}`}
              sub={target.blocked ? "Volverás a ver sus mensajes." : "No verás sus mensajes en este chat."}
              disabled={busy}
              onPress={() => onToggleBlock(target)}
              icon={
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
                  <Circle cx={12} cy={12} r={10} />
                  <Path d="m4.9 4.9 14.2 14.2" />
                </Svg>
              }
            />
          );
        })}

        <OptionRow
          testID="chat-safety-report"
          color={colors.fg1}
          title={reported ? "Reporte enviado" : "Reportar conversación"}
          sub={reported ? "Lo revisa el equipo de Movo." : "Solo lo ve el equipo de Movo."}
          disabled={busy || reported}
          onPress={onReport}
          icon={
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.fg1} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7" />
            </Svg>
          }
        />
      </View>
    </BottomSheetModal>
  );
}
