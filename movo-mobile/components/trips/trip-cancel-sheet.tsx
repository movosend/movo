import { AlertTriangle } from "lucide-react-native";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { ErrorBanner } from "../ui/error-banner";

/**
 * Bottom sheet de confirmación de "Cancelar viaje" (MOVO-263 AC6, mockup de Claude Design).
 * El error de la mutación (ej. 409 por un paquete aceptado en el medio) se muestra adentro y
 * no cierra el sheet: el usuario lo lee antes de volver.
 */
export function TripCancelSheet({
  visible,
  destination,
  isCancelling,
  errorMessage,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  destination: string;
  isCancelling: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  return (
    <Modal visible={isMounted} transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Animated.View
          style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, backdropStyle]}
          className="bg-ink-950/50"
        >
          <Pressable testID="trip-cancel-backdrop" className="flex-1" onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={sheetStyle}
          className="items-center rounded-t-[14px] bg-bg px-5 pb-[38px] pt-2.5"
        >
          <View className="h-1 w-9 rounded-full bg-border-strong" />
          <View className="mt-6 h-[60px] w-[60px] items-center justify-center rounded-full bg-danger-100">
            <AlertTriangle size={28} color="#E5484D" strokeWidth={1.75} />
          </View>
          <Text className="mt-4 text-center font-sans-semibold text-[20px] tracking-[-0.4px] text-fg">
            ¿Cancelar el viaje a {destination}?
          </Text>
          <Text className="mt-2 max-w-[320px] text-center font-sans text-[14px] leading-[21px] text-fg-3">
            Va a pasar a tu historial como cancelado y dejarás de recibir avisos de paquetes compatibles.
          </Text>
          {errorMessage ? (
            <View className="mt-4 self-stretch">
              <ErrorBanner testID="trip-cancel-error" message={errorMessage} />
            </View>
          ) : null}
          <Pressable
            testID="trip-cancel-confirm"
            onPress={onConfirm}
            disabled={isCancelling}
            accessibilityRole="button"
            className="mt-6 h-[52px] self-stretch items-center justify-center rounded-lg bg-danger-500 active:opacity-90"
          >
            {isCancelling ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="font-sans-semibold text-[16px] text-white">Sí, cancelar viaje</Text>
            )}
          </Pressable>
          <Pressable
            testID="trip-cancel-dismiss"
            onPress={onClose}
            disabled={isCancelling}
            className="mt-1.5 h-12 self-stretch items-center justify-center rounded-lg"
          >
            <Text className="font-sans-medium text-[15px] text-fg">Volver</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
