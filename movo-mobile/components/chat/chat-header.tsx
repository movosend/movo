import type { ChatParticipant } from "@movo/shared/dist/types/chat";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { joinNames } from "../../src/lib/chat-format";
import { ChatAvatar } from "./chat-avatar";

const AVATAR = 30;

/**
 * MOVO-284: encabezado de la conversación, calcado del prototipo: volver transparente de 36 px, título
 * 17/600 con los nombres debajo, avatares de 30 px superpuestos 8 px y menú de tres puntos.
 * `onOptions` ausente oculta el menú (los estados del prototipo sin acciones).
 */
export function ChatHeader({
  participants = [],
  onBack,
  onOptions,
  onPressParticipants,
  title = "Chat del envío",
  subtitle,
  trailing,
}: {
  participants?: readonly Pick<
    ChatParticipant,
    "userId" | "firstName" | "fullName" | "photoUrl"
  >[];
  /** MOVO-324: el chat de soporte reusa el encabezado con otro título... */
  title?: string;
  /** ...otro subtítulo (código y tema en vez de los nombres)... */
  subtitle?: string;
  /** ...y otra cosa en vez de los avatares (el isotipo de Movo). */
  trailing?: ReactNode;
  onBack: () => void;
  onOptions?: () => void;
  /** Tocar los avatares abre el detalle del envío. */
  onPressParticipants?: () => void;
}) {
  const colors = useThemeColors();
  const names = subtitle ?? joinNames(participants.map((p) => p.firstName));

  return (
    <View
      className="flex-row items-center"
      style={{
        gap: 8,
        paddingTop: 6,
        paddingRight: 12,
        paddingBottom: 8,
        paddingLeft: 8,
      }}
    >
      <Pressable
        testID="chat-back"
        accessibilityLabel="Volver"
        onPress={onBack}
        className="items-center justify-center active:bg-bg-mute"
        style={{ width: 36, height: 36, borderRadius: 18 }}
      >
        <Svg
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.fg1}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="m15 18-6-6 6-6" />
        </Svg>
      </Pressable>
      <View className="min-w-0 flex-1">
        <Text className="font-sans-semibold text-h3 text-fg" numberOfLines={1}>
          {title}
        </Text>
        {names ? (
          <Text
            testID="chat-header-names"
            className="font-sans text-small text-fg-3"
            numberOfLines={1}
          >
            {names}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={{ paddingRight: 4 }}>{trailing}</View> : null}
      {trailing ? null : (
        <Pressable
          testID="chat-header-avatars"
          accessibilityRole="button"
          accessibilityLabel="Ver el detalle del envío"
          disabled={!onPressParticipants}
          onPress={onPressParticipants}
          hitSlop={6}
          className="flex-row"
          style={{ paddingRight: 4 }}
        >
          {participants.map((p, index) => (
            <View
              key={p.userId}
              style={{
                marginLeft: index === 0 ? 0 : -8,
                borderWidth: 2,
                borderColor: colors.bg,
                borderRadius: AVATAR / 2 + 2,
              }}
            >
              <ChatAvatar
                fullName={p.fullName}
                photoUrl={p.photoUrl}
                size={AVATAR}
                fontSize={10}
              />
            </View>
          ))}
        </Pressable>
      )}
      {onOptions ? (
        <Pressable
          testID="chat-options"
          accessibilityLabel="Más opciones"
          onPress={onOptions}
          className="items-center justify-center active:bg-bg-mute"
          style={{ width: 36, height: 36, borderRadius: 18 }}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill={colors.fg1}>
            <Circle cx={12} cy={5} r={1.7} />
            <Circle cx={12} cy={12} r={1.7} />
            <Circle cx={12} cy={19} r={1.7} />
          </Svg>
        </Pressable>
      ) : null}
    </View>
  );
}
