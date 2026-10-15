import { AlertTriangle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { ErrorBanner } from "../ui/error-banner";

/**
 * Bottom sheet de confirmación de "Cancelar viaje" (MOVO-263 AC6, mockup de Claude Design).
 * El error de la mutación (ej. 409 por un paquete aceptado en el medio) se muestra adentro y
 * no cierra el sheet: el usuario lo lee antes de volver.
 *
 * MOVO-266: en el viaje vigente de una serie recurrente (`recurring`) suma dos opciones,
 * "Solo este viaje" (default, la serie sigue) y "Este y dejar de repetir"; `onConfirm`
 * recibe cuál se eligió. Sin `recurring` queda igual que antes.
 */
export function TripCancelSheet({
  visible,
  destination,
  isCancelling,
  errorMessage,
  recurring,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  destination: string;
  isCancelling: boolean;
  errorMessage?: string | null;
  /** Nombre del día de la salida ("viernes"), para "el viaje de este viernes". */
  recurring?: { weekdayName: string };
  onConfirm: (stopRecurrence: boolean) => void;
  onClose: () => void;
}) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  const [stopRecurrence, setStopRecurrence] = useState(false);
  // Cada apertura arranca en la opción default.
  useEffect(() => {
    if (visible) setStopRecurrence(false);
  }, [visible]);

  const options = recurring
    ? [
        {
          value: false,
          title: "Solo este viaje",
          description: `Cancelás solo el viaje de este ${recurring.weekdayName}; el del próximo se declara igual.`,
        },
        {
          value: true,
          title: "Este y dejar de repetir",
          description: "Cancelás este viaje y no declaramos los siguientes.",
        },
      ]
    : null;

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
          {options ? (
            <View className="mt-5 self-stretch overflow-hidden rounded-[10px] border border-border">
              {options.map((option, index) => {
                const selected = stopRecurrence === option.value;
                return (
                  <Pressable
                    key={option.title}
                    testID={option.value ? "trip-cancel-option-stop" : "trip-cancel-option-only"}
                    onPress={() => setStopRecurrence(option.value)}
                    disabled={isCancelling}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    className={`flex-row gap-3 px-3.5 py-3 ${index > 0 ? "border-t border-border" : ""}`}
                  >
                    <View
                      className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full border-[1.5px] ${
                        selected ? "border-fg" : "border-border-strong"
                      }`}
                    >
                      {selected ? <View className="h-2.5 w-2.5 rounded-full bg-fg" /> : null}
                    </View>
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text className="font-sans-semibold text-[15px] text-fg">{option.title}</Text>
                      <Text className="font-sans text-[13px] leading-[19px] text-fg-3">{option.description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {errorMessage ? (
            <View className="mt-4 self-stretch">
              <ErrorBanner testID="trip-cancel-error" message={errorMessage} />
            </View>
          ) : null}
          <Pressable
            testID="trip-cancel-confirm"
            onPress={() => onConfirm(stopRecurrence)}
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
