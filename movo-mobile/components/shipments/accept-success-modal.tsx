import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

const SUCCESS_LIME = "#C6F24A";
const CHECK_CIRCLE = "#0A0A0B";
const SUCCESS_DELAY_MS = 80;
const BOUNCE = Easing.bezier(0.34, 1.56, 0.64, 1);

export interface AcceptSuccessModalProps {
  visible: boolean;
  onDismiss: () => void;
  testID?: string;
}

/**
 * Pantalla completa de confirmación animada al aceptar un envío (MOVO-132 / MOVO-131).
 * Vive a nivel de pantalla en `ShipmentDetailScreen` para no desmontarse cuando el status
 * del envío pasa a `published` y se desmonta `ReceiverActionsBar`.
 */
export function AcceptSuccessModal({ visible, onDismiss, testID }: AcceptSuccessModalProps) {
  const successOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0.4);

  useEffect(() => {
    if (visible) {
      successOpacity.value = 0;
      checkScale.value = 0.4;
      successOpacity.value = withDelay(
        SUCCESS_DELAY_MS,
        withTiming(1, { duration: 260 }),
      );
      checkScale.value = withDelay(
        SUCCESS_DELAY_MS,
        withTiming(1, { duration: 420, easing: BOUNCE }),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [visible, checkScale, successOpacity]);

  const successStyle = useAnimatedStyle(() => ({
    opacity: successOpacity.value,
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      testID={testID ?? "receiver-accept-success-modal"}
    >
      <View className="flex-1 items-center justify-center bg-[#C6F24A] px-10">
        <Animated.View style={[{ alignItems: "center", width: "100%", gap: 20 }, successStyle]}>
          <Animated.View
            style={[
              {
                width: 72,
                height: 72,
                borderRadius: 999,
                backgroundColor: CHECK_CIRCLE,
                alignItems: "center",
                justifyContent: "center",
              },
              checkStyle,
            ]}
          >
            <Svg width={34} height={34} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 12.5L9.5 18L20 6"
                stroke={SUCCESS_LIME}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>

          <View className="items-center">
            <Text className="mb-2 font-sans-semibold text-[22px] tracking-tight text-ink-950">
              Envío aceptado
            </Text>
            <Text className="text-center font-sans text-[14px] leading-[21px] text-[#3A3A40]">
              Confirmaste que esperás este paquete. El emisor fue notificado y el envío ya está publicado para transportistas.
            </Text>
          </View>

          <Pressable
            testID={testID ? `${testID}-view-button` : "receiver-accept-success-button"}
            onPress={onDismiss}
            className="mt-2 rounded-full border border-black/25 px-5 py-2.5"
          >
            <Text className="font-sans-medium text-[13px] text-ink-950">
              Ver detalle
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
