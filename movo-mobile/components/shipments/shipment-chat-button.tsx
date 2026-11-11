import * as Haptics from "expo-haptics";
import { MessageCircle } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface ShipmentChatButtonProps {
  chat: "open" | "read_only";
  unread: number;
  onPress: () => void;
  /** `inline`: al lado de otros elementos de la fila (punto sobre la esquina). `block`: ancho completo con el punto junto al texto. */
  layout: "inline" | "block";
  testID: string;
  unreadTestID: string;
}

/** Botón "Chat" del envío: relleno si se puede escribir, contorno si es solo lectura. */
export function ShipmentChatButton({ chat, unread, onPress, layout, testID, unreadTestID }: ShipmentChatButtonProps) {
  const colors = useThemeColors();
  const open = chat === "open";
  const inline = layout === "inline";
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        open
          ? unread > 0
            ? `Abrir el chat del envío, ${unread} sin leer`
            : "Abrir el chat del envío"
          : "Ver la conversación del envío"
      }
      className={`h-11 flex-row items-center gap-2 rounded-[10px] active:opacity-80 ${
        inline ? "px-4" : "mt-3 justify-center"
      } ${open ? "bg-fg" : "border border-border-strong bg-bg"}`}
    >
      <MessageCircle size={17} color={open ? colors.bg : colors.fg1} strokeWidth={2} />
      <Text className={`font-sans-semibold text-body ${open ? "text-bg" : "text-fg"}`}>Chat</Text>
      {unread > 0 ? (
        <View
          testID={unreadTestID}
          className={
            inline
              ? "absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-bg bg-lime-500"
              : "h-2.5 w-2.5 rounded-full bg-lime-500"
          }
        />
      ) : null}
    </Pressable>
  );
}
