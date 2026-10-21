import { router } from "expo-router";
import { BookOpen, ChevronLeft, ChevronRight, MessageCircle, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TourReplaySheet } from "../../../components/tour/tour-replay-sheet";
import { useSupportList } from "../../../src/hooks/use-support";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { formatUnreadCount } from "../../../src/lib/chat-format";
import { pushOnce } from "../../../src/lib/navigation-guard";
import { supportTotalUnread } from "../../../src/lib/support-format";

interface HelpRow {
  key: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  onPress: () => void;
  unread?: number;
}

/**
 * MOVO-324: "Ayuda y soporte" de Perfil, un submenú con las formas de recibir ayuda. Hoy: escribirle al equipo de Movo
 * (la lista de consultas) y repasar el tutorial; queda armado como lista de filas para sumar preguntas frecuentes y más.
 */
export default function SupportHubScreen() {
  const colors = useThemeColors();
  const [tourSheetOpen, setTourSheetOpen] = useState(false);
  const unread = supportTotalUnread(useSupportList().data);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/home" as never);
  };

  const rows: HelpRow[] = [
    {
      key: "chat",
      label: "Chatea con Soporte de Movo",
      description: "Consultas sobre un envío, un pago o tu cuenta. Te respondemos por acá.",
      Icon: MessageCircle,
      onPress: () => pushOnce("/support/conversations"),
      unread,
    },
    {
      key: "tour",
      label: "Repasar el tutorial",
      description: "Volvé a ver cómo funciona la app, paso a paso.",
      Icon: BookOpen,
      onPress: () => setTourSheetOpen(true),
    },
  ];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="flex-row items-center gap-3 px-4 pb-2 pt-2">
        <Pressable testID="support-hub-back" accessibilityLabel="Volver" onPress={goBack} className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute">
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
      </View>
      <Text className="font-sans-semibold text-title text-fg" style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
        Ayuda y soporte
      </Text>
      <Text className="font-sans text-small text-fg-3" style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
        ¿En qué te podemos ayudar?
      </Text>

      <View className="mx-4 overflow-hidden rounded-[10px] border border-border bg-bg-sub">
        {rows.map(({ key, label, description, Icon, onPress, unread: rowUnread }, index) => (
          <Pressable
            key={key}
            testID={`support-hub-${key}`}
            onPress={onPress}
            className={`flex-row items-center gap-3 px-4 py-4 ${index < rows.length - 1 ? "border-b border-border" : ""}`}
          >
            <Icon size={20} strokeWidth={1.8} color={colors.fg2} />
            <View className="min-w-0 flex-1" style={{ gap: 2 }}>
              <Text className="font-sans text-[15px] text-fg">{label}</Text>
              <Text className="font-sans text-fg-3" style={{ fontSize: 12 }}>
                {description}
              </Text>
            </View>
            {rowUnread ? (
              <View
                testID={`support-hub-${key}-unread`}
                className="items-center justify-center"
                style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#C6F24A", paddingHorizontal: 6 }}
              >
                <Text className="font-sans-semibold" style={{ fontSize: 11, color: "#0A0A0B" }}>
                  {formatUnreadCount(rowUnread)}
                </Text>
              </View>
            ) : null}
            <ChevronRight size={18} strokeWidth={1.8} color={colors.fg3} />
          </Pressable>
        ))}
      </View>

      <TourReplaySheet visible={tourSheetOpen} onClose={() => setTourSheetOpen(false)} />
    </SafeAreaView>
  );
}
