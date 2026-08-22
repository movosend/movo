import { ApiError } from "@movo/shared/dist/errors/api-error";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { useCancelShipment } from "../../src/hooks/use-shipments";
import { ErrorBanner } from "../ui/error-banner";
import { TextField } from "../ui/text-field";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export interface SenderActionsBarProps {
  shipmentId: string;
  onRefetch?: () => void;
  testID?: string;
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 404) {
      return "Este envío ya no existe.";
    }
    if (error.statusCode === 403) {
      return "No sos el emisor de este envío.";
    }
    if (error.statusCode === 409) {
      if (error.code === "SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED") {
        return "Este envío ya tiene un transportista asignado y no se puede cancelar desde la app todavía.";
      }
      return "Este envío ya no se puede cancelar.";
    }
  }
  return "No pudimos cancelar el envío. Probá de nuevo.";
}

/**
 * Barra de acciones del emisor (MOVO-29, implementado en MOVO-108): fija al pie del
 * detalle de envío cuando el usuario autenticado es el emisor y el envío está en un
 * estado cancelable (`canCancelShipment`, `shipment-format.ts`).
 *
 * - "Cancelar envío" (secundaria/destructiva): abre modal de confirmación, mismo
 *   patrón que el rechazo del receptor (`ReceiverActionsBar`) — motivo opcional
 *   (persistido en el historial, AC5 de MOVO-29) y advertencia de irreversibilidad.
 * - Deshabilita el botón durante mutación en vuelo para prevenir double tap.
 * - Maneja errores 403/404/409 (dos códigos distintos)/genérico con mensajes
 *   específicos; un 409 dispara `onRefetch?.()` porque el estado real cambió de lo
 *   que la pantalla asumía (carrera con una asignación concurrente, por ejemplo).
 */
export function SenderActionsBar({ shipmentId, onRefetch, testID }: SenderActionsBarProps) {
  const cancelMutation = useCancelShipment();

  const [isCancelModalVisible, setIsCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBusy = cancelMutation.isPending;

  const handleCancelPress = () => {
    if (isBusy) return;
    setErrorMessage(null);
    setCancelReason("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsCancelModalVisible(true);
  };

  const handleConfirmCancel = async () => {
    try {
      await cancelMutation.mutateAsync({
        id: shipmentId,
        reason: cancelReason.trim() || undefined,
      });
      setIsCancelModalVisible(false);
    } catch (err) {
      const msg = resolveErrorMessage(err);
      setErrorMessage(msg);
      if (err instanceof ApiError && err.statusCode === 409) {
        onRefetch?.();
      }
      setIsCancelModalVisible(false);
    }
  };

  return (
    <View testID={testID} className="border-t border-border bg-bg px-5 pb-5 pt-3.5 shadow-sm">
      {errorMessage ? (
        <View className="mb-3">
          <ErrorBanner testID={testID ? `${testID}-error` : "sender-actions-error"} message={errorMessage} />
        </View>
      ) : null}

      <Pressable
        testID={testID ? `${testID}-cancel-button` : "sender-actions-cancel-button"}
        onPress={handleCancelPress}
        disabled={isBusy}
        className={`w-full items-center justify-center rounded-lg border border-border py-3.5 ${
          isBusy ? "opacity-50" : "bg-bg"
        }`}
      >
        <Text className="font-sans-semibold text-body text-danger-500">Cancelar envío</Text>
      </Pressable>

      {/* Modal de confirmación de cancelación */}
      <Modal
        visible={isCancelModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsCancelModalVisible(false)}
        testID={testID ? `${testID}-cancel-modal` : "sender-cancel-modal"}
      >
        <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
          <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View className="flex-1 justify-end bg-black/40">
              <Pressable
                testID={testID ? `${testID}-cancel-modal-backdrop` : "sender-cancel-modal-backdrop"}
                onPress={() => !isBusy && setIsCancelModalVisible(false)}
                className="flex-1"
              />
              <SafeAreaView className="rounded-t-2xl bg-bg" edges={["bottom"]}>
                <View className="px-5 pt-5">
                  <Text className="mb-1 font-sans-semibold text-h3 text-fg">¿Cancelar este envío?</Text>
                  <Text className="mb-4 font-sans text-small text-fg-3">
                    Esta acción es irreversible. El envío quedará cancelado y, si ya tenía
                    ofertas, cada transportista será notificado.
                  </Text>

                  <TextField
                    testID={testID ? `${testID}-cancel-reason-input` : "sender-cancel-reason-input"}
                    label="Motivo de la cancelación (opcional)"
                    placeholder="Ej: Me equivoqué de dirección, ya no lo necesito..."
                    value={cancelReason}
                    onChangeText={setCancelReason}
                    maxLength={500}
                  />

                  <View className="mt-2 flex-col gap-2.5 pb-4 pt-2">
                    <Pressable
                      testID={testID ? `${testID}-cancel-confirm-button` : "sender-cancel-confirm-button"}
                      onPress={() => void handleConfirmCancel()}
                      disabled={cancelMutation.isPending}
                      className={`w-full flex-row items-center justify-center gap-2 rounded-lg bg-danger-500 py-3.5 ${
                        cancelMutation.isPending ? "opacity-70" : ""
                      }`}
                    >
                      {cancelMutation.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                      <Text className="font-sans-semibold text-body text-white">Confirmar cancelación</Text>
                    </Pressable>

                    <Pressable
                      testID={testID ? `${testID}-cancel-dismiss-button` : "sender-cancel-dismiss-button"}
                      onPress={() => setIsCancelModalVisible(false)}
                      disabled={cancelMutation.isPending}
                      className="w-full items-center justify-center py-2.5"
                    >
                      <Text className="font-sans-medium text-body text-fg-2">Volver</Text>
                    </Pressable>
                  </View>
                </View>
              </SafeAreaView>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}
