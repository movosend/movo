import { ApiError } from "@movo/shared/dist/errors/api-error";
import * as Haptics from "expo-haptics";
import { Clock } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import {
  useAcceptShipment,
  useRejectShipment,
} from "../../src/hooks/use-shipments";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatReceiverConfirmationDeadline } from "../../src/lib/shipment-format";
import { ErrorBanner } from "../ui/error-banner";
import { TextField } from "../ui/text-field";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export interface ReceiverActionsBarProps {
  shipmentId: string;
  receiverConfirmationDeadline?: string | null;
  onRefetch?: () => void;
  testID?: string;
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 409) {
      return "Este envío ya no se puede confirmar.";
    }
    if (error.statusCode === 403) {
      return "No sos el destinatario de este envío.";
    }
  }
  return "No pudimos procesar tu respuesta. Probá de nuevo.";
}

/**
 * Barra de acciones del receptor (MOVO-131, AC4/AC6/AC9):
 * Fija al pie del detalle de envío cuando el usuario autenticado es el receptor
 * y el envío está en `awaiting_receiver_confirmation`.
 *
 * - "Aceptar envío" (CTA primaria, acento lime): pide confirmación nativa `Alert.alert`
 *   y llama a `POST /shipments/:id/accept`.
 * - "Rechazar" (secundaria/destructiva): abre modal de confirmación para ingresar un
 *   motivo opcional y advierte que la acción es irreversible (`rejected_by_receiver` es terminal).
 * - Muestra tiempo restante para confirmar si `receiverConfirmationDeadline` está presente.
 * - Deshabilita ambos botones durante mutación en vuelo para prevenir double tap.
 * - Maneja errores 409/403/genérico con mensajes específicos.
 */
export function ReceiverActionsBar({
  shipmentId,
  receiverConfirmationDeadline,
  onRefetch,
  testID,
}: ReceiverActionsBarProps) {
  const colors = useThemeColors();
  const acceptMutation = useAcceptShipment();
  const rejectMutation = useRejectShipment();

  const [isRejectModalVisible, setIsRejectModalVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isMounted, backdropStyle, sheetStyle } =
    useSheetAnimation(isRejectModalVisible);

  const deadlineLabel = formatReceiverConfirmationDeadline(
    receiverConfirmationDeadline,
  );
  const isBusy = acceptMutation.isPending || rejectMutation.isPending;

  const handleAcceptPress = () => {
    if (isBusy) return;
    setErrorMessage(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    Alert.alert(
      "¿Aceptar este envío?",
      "Vas a confirmar que esperás este paquete. El emisor será notificado y el envío pasará a estar publicado para transportistas.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Aceptar envío",
          onPress: async () => {
            try {
              await acceptMutation.mutateAsync({ id: shipmentId });
            } catch (err) {
              const msg = resolveErrorMessage(err);
              setErrorMessage(msg);
              if (err instanceof ApiError && err.statusCode === 409) {
                onRefetch?.();
              }
            }
          },
        },
      ],
    );
  };

  const handleRejectPress = () => {
    if (isBusy) return;
    setErrorMessage(null);
    setRejectReason("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRejectModalVisible(true);
  };

  const handleConfirmReject = async () => {
    try {
      await rejectMutation.mutateAsync({
        id: shipmentId,
        reason: rejectReason.trim() || undefined,
      });
      setIsRejectModalVisible(false);
    } catch (err) {
      const msg = resolveErrorMessage(err);
      setErrorMessage(msg);
      if (err instanceof ApiError && err.statusCode === 409) {
        onRefetch?.();
      }
      setIsRejectModalVisible(false);
    }
  };

  return (
    <View
      testID={testID}
      className="border-t border-border bg-bg px-5 pb-5 pt-3.5 shadow-sm"
    >
      {errorMessage ? (
        <View className="mb-3">
          <ErrorBanner
            testID={testID ? `${testID}-error` : "receiver-actions-error"}
            message={errorMessage}
          />
        </View>
      ) : null}

      {deadlineLabel ? (
        <View
          testID={testID ? `${testID}-deadline` : "receiver-actions-deadline"}
          className="mb-3 flex-row items-center justify-center gap-1.5"
        >
          <Clock size={13} color={colors.fg3} strokeWidth={1.8} />
          <Text className="font-sans text-small text-fg-3">
            {deadlineLabel}
          </Text>
        </View>
      ) : null}

      <View className="flex-row gap-3">
        <Pressable
          testID={
            testID
              ? `${testID}-reject-button`
              : "receiver-actions-reject-button"
          }
          onPress={handleRejectPress}
          disabled={isBusy}
          className={`flex-1 items-center justify-center rounded-lg border border-border py-3.5 ${
            isBusy ? "opacity-50" : "bg-bg"
          }`}
        >
          <Text className="font-sans-semibold text-body text-danger-500">
            Rechazar
          </Text>
        </Pressable>

        <Pressable
          testID={
            testID
              ? `${testID}-accept-button`
              : "receiver-actions-accept-button"
          }
          onPress={handleAcceptPress}
          disabled={isBusy}
          className={`flex-[2] flex-row items-center justify-center gap-2 rounded-lg py-3.5 ${
            isBusy ? "bg-bg-mute" : "bg-lime-500"
          }`}
        >
          {acceptMutation.isPending ? (
            <ActivityIndicator size="small" color="#0A0A0B" />
          ) : null}
          <Text
            className={`font-sans-semibold text-body ${
              isBusy ? "text-fg-3" : "text-ink-950"
            }`}
          >
            Aceptar envío
          </Text>
        </Pressable>
      </View>

      {/* Modal de confirmación de rechazo */}
      <Modal
        visible={isMounted}
        animationType="none"
        transparent
        onRequestClose={() => setIsRejectModalVisible(false)}
        testID={testID ? `${testID}-reject-modal` : "receiver-reject-modal"}
      >
        <SafeAreaProvider
          initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}
        >
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View className="flex-1">
              {/* Overlay: solo hace fade (nunca se desliza) — ver `useSheetAnimation`. */}
              <Animated.View
                style={[StyleSheet.absoluteFill, backdropStyle]}
              >
                <Pressable
                  testID={
                    testID
                      ? `${testID}-reject-modal-backdrop`
                      : "receiver-reject-modal-backdrop"
                  }
                  onPress={() => !isBusy && setIsRejectModalVisible(false)}
                  className="flex-1 bg-black/40"
                />
              </Animated.View>
              <View className="flex-1 justify-end" pointerEvents="box-none">
                <Animated.View style={sheetStyle}>
                  <SafeAreaView
                    className="rounded-t-2xl bg-bg"
                    edges={["bottom"]}
                  >
                    <View className="px-5 pt-5">
                      <Text className="mb-1 font-sans-semibold text-h3 text-fg">
                        ¿Rechazar este envío?
                      </Text>
                      <Text className="mb-4 font-sans text-small text-fg-3">
                        Esta acción es irreversible. El envío será cancelado y
                        el emisor será notificado.
                      </Text>

                      <TextField
                        testID={
                          testID
                            ? `${testID}-reject-reason-input`
                            : "receiver-reject-reason-input"
                        }
                        label="Motivo del rechazo (opcional)"
                        placeholder="Ej: No pedí este paquete, dirección incorrecta..."
                        value={rejectReason}
                        onChangeText={setRejectReason}
                        maxLength={500}
                      />

                      <View className="mt-2 flex-col gap-2.5 pb-4 pt-2">
                        <Pressable
                          testID={
                            testID
                              ? `${testID}-reject-confirm-button`
                              : "receiver-reject-confirm-button"
                          }
                          onPress={() => void handleConfirmReject()}
                          disabled={rejectMutation.isPending}
                          className={`w-full flex-row items-center justify-center gap-2 rounded-lg bg-danger-500 py-3.5 ${
                            rejectMutation.isPending ? "opacity-70" : ""
                          }`}
                        >
                          {rejectMutation.isPending ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : null}
                          <Text className="font-sans-semibold text-body text-white">
                            Confirmar rechazo
                          </Text>
                        </Pressable>

                        <Pressable
                          testID={
                            testID
                              ? `${testID}-reject-cancel-button`
                              : "receiver-reject-cancel-button"
                          }
                          onPress={() => setIsRejectModalVisible(false)}
                          disabled={rejectMutation.isPending}
                          className="w-full items-center justify-center py-2.5"
                        >
                          <Text className="font-sans-medium text-body text-fg-2">
                            Volver
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </SafeAreaView>
                </Animated.View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}
