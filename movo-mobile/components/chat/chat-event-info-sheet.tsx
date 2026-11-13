import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { ArrowLeftRight, ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { chatEventExplanation, type ChatEventCard } from "../../src/lib/chat-format";
import { formatEventTimestamp, shipmentStatusLabel } from "../../src/lib/shipment-format";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { shipmentStatusVisual } from "../shipments/shipment-status-visual";

/**
 * Hoja que se abre al tocar un cambio de estado en el chat: qué pasó, cuándo, qué significa y qué sigue, con acceso
 * a la línea de tiempo completa del envío. Mismo armado que "Tu seguridad" (agarrador, `BottomSheetModal`).
 */
export function ChatEventInfoSheet({
  card,
  onClose,
  onOpenTimeline,
}: {
  card: ChatEventCard | null;
  onClose: () => void;
  onOpenTimeline: () => void;
}) {
  const colors = useThemeColors();
  const visual = card?.status
    ? shipmentStatusVisual(card.offerAccepted ? ShipmentStatus.ASSIGNMENT_PENDING : card.status)
    : { Icon: ArrowLeftRight, bgClass: "bg-bg-mute", iconColor: null };
  const { Icon } = visual;
  const paragraphs = card ? chatEventExplanation(card) : [];

  return (
    <BottomSheetModal
      visible={card !== null}
      onRequestClose={onClose}
      testID="chat-event-sheet"
      backdropTestID="chat-event-sheet-backdrop"
      backdropClassName="bg-ink-950/50"
      sheetClassName="rounded-t-[24px] bg-bg"
      contentClassName="px-5 pt-2.5"
    >
      {card ? (
        <View style={{ gap: 14, paddingBottom: 18 }}>
          <View className="self-center bg-border-strong" style={{ width: 40, height: 4, borderRadius: 2 }} />
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <View className={`h-11 w-11 items-center justify-center rounded-full ${visual.bgClass}`}>
              <Icon size={20} strokeWidth={2} color={visual.iconColor ?? colors.fg3} />
            </View>
            <View className="flex-1" style={{ gap: 2 }}>
              <Text testID="chat-event-sheet-title" className="font-sans-semibold text-[16px] text-fg">
                {card.text}
              </Text>
              <Text className="font-sans text-small text-fg-3">
                {formatEventTimestamp(card.createdAt) ?? ""}
                {card.status ? ` · ${shipmentStatusLabel(card.status)}` : ""}
              </Text>
            </View>
          </View>
          {paragraphs.length > 0 ? (
            <View testID="chat-event-sheet-body" style={{ gap: 8 }}>
              {paragraphs.map((text) => (
                <Text key={text} className="font-sans text-body leading-[22px] text-fg-2">
                  {text}
                </Text>
              ))}
            </View>
          ) : null}
          <Pressable
            testID="chat-event-sheet-timeline"
            onPress={onOpenTimeline}
            className="h-12 flex-row items-center justify-between rounded-lg border border-border-strong px-4 active:opacity-70"
          >
            <Text className="font-sans-medium text-[15px] text-fg">Ver la línea de tiempo del envío</Text>
            <ChevronRight size={18} color={colors.fg3} strokeWidth={1.75} />
          </Pressable>
        </View>
      ) : null}
    </BottomSheetModal>
  );
}
