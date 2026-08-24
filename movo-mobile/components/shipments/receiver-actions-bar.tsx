import { ApiError } from "@movo/shared/dist/errors/api-error";
import * as Haptics from "expo-haptics";
import { Clock } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
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

const SUCCESS_LIME = "#C6F24A";
const CHECK_CIRCLE = "#0A0A0B";
const SUCCESS_DELAY_MS = 80;
const BOUNCE = Easing.bezier(0.34, 1.56, 0.64, 1);

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export interface ReceiverActionsBarProps {
  shipmentId: string;
  receiverConfirmationDeadline?: string | null;
  onRefetch?: () => void;
  onAcceptSuccess?: () => void;
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
 * - "Aceptar envío": abre modal propio in-app de confirmación, ejecuta `POST /shipments/:id/accept`
 *   y notifica éxito para desplegar animación de confirmación a pantalla completa.
 * - "Rechazar": abre modal propio in-app de confirmación para ingresar un
 *   motivo opcional y advierte que la acción es irreversible (`rejected_by_receiver` es terminal).
 * - Muestra tiempo restante para confirmar si `receiverConfirmationDeadline` está presente.
 * - Deshabilita ambos botones durante mutación en vuelo para prevenir double tap.
 * - Maneja errores 409/403/genérico con mensajes específicos.
 */
export function ReceiverActionsBar({
  shipmentId,
  receiverConfirmationDeadline,
  onRefetch,
  onAcceptSuccess,
  testID,
}: ReceiverActionsBarProps) {
  const colors = useThemeColors();
  const acceptMutation = useAcceptShipment();
  const rejectMutation = useRejectShipment();

  const [isAcceptModalVisible, setIsAcceptModalVisible] = useState(false);
  const [isSuccessVisible, setIsSuccessVisible] = useState(false);
  const [isRejectModalVisible, setIsRejectModalVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isMounted, backdropStyle, sheetStyle } =
    useSheetAnimation(isRejectModalVisible);

  const successOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0.4);

  const deadlineLabel = formatReceiverConfirmationDeadline(receiverConfirmationDeadline);
  const isBusy = acceptMutation.isPending || rejectMutation.isPending;

  const handleAcceptPress = () => {
    if (isBusy) return;
    setErrorMessage(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsAcceptModalVisible(true);
  };

  const handleConfirmAccept = async () => {
    try {
      await acceptMutation.mutateAsync({ id: shipmentId });
      setIsAcceptModalVisible(false);
      if (onAcceptSuccess) {
        onAcceptSuccess();
      } else {
        setIsSuccessVisible(true);
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
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      const msg = resolveErrorMessage(err);
      setErrorMessage(msg);
      if (err instanceof ApiError && err.statusCode === 409) {
        onRefetch?.();
      }
      setIsAcceptModalVisible(false);
    }
  };

  const handleDismissSuccess = () => {
    setIsSuccessVisible(false);
    onRefetch?.();
  };

  const successStyle = useAnimatedStyle(() => ({
    opacity: successOpacity.value,
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

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

      {/* Modal de confirmación de aceptación */}
      <Modal
        visible={isAcceptModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => !isBusy && setIsAcceptModalVisible(false)}
        testID={testID ? `${testID}-accept-modal` : "receiver-accept-modal"}
      >
        <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
          <View className="flex-1 justify-end bg-black/40">
            <Pressable
              testID={testID ? `${testID}-accept-modal-backdrop` : "receiver-accept-modal-backdrop"}
              onPress={() => !isBusy && setIsAcceptModalVisible(false)}
              className="flex-1"
            />
            <SafeAreaView className="rounded-t-2xl bg-bg" edges={["bottom"]}>
              <View className="px-5 pt-5">
                <Text className="mb-1 font-sans-semibold text-h3 text-fg">
                  ¿Aceptar este envío?
                </Text>
                <Text className="mb-4 font-sans text-small text-fg-3">
                  Vas a confirmar que esperás este paquete. El emisor será notificado
                  y el envío pasará a estar publicado para transportistas.
                </Text>

                <View className="mt-2 flex-col gap-2.5 pb-4 pt-2">
                  <Pressable
                    testID={testID ? `${testID}-accept-confirm-button` : "receiver-accept-confirm-button"}
                    onPress={() => void handleConfirmAccept()}
                    disabled={acceptMutation.isPending}
                    className={`w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-3.5 ${
                      acceptMutation.isPending ? "opacity-70" : ""
                    }`}
                  >
                    {acceptMutation.isPending ? (
                      <ActivityIndicator size="small" color="#0A0A0B" />
                    ) : null}
                    <Text className="font-sans-semibold text-body text-ink-950">
                      Confirmar y aceptar
                    </Text>
                  </Pressable>

                  <Pressable
                    testID={testID ? `${testID}-accept-cancel-button` : "receiver-accept-cancel-button"}
                    onPress={() => setIsAcceptModalVisible(false)}
                    disabled={acceptMutation.isPending}
                    className="w-full items-center justify-center py-2.5"
                  >
                    <Text className="font-sans-medium text-body text-fg-2">
                      Volver
                    </Text>
                  </Pressable>
                </View>
              </View>
            </SafeAreaView>
          </View>
        </SafeAreaProvider>
      </Modal>

      {/* Modal a pantalla completa de confirmación animada */}
      <Modal
        visible={isSuccessVisible}
        transparent
        animationType="fade"
        onRequestClose={handleDismissSuccess}
        testID={testID ? `${testID}-success-modal` : "receiver-accept-success-modal"}
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
              testID={testID ? `${testID}-success-view-button` : "receiver-accept-success-button"}
              onPress={handleDismissSuccess}
              className="mt-2 rounded-full border border-black/25 px-5 py-2.5"
            >
              <Text className="font-sans-medium text-[13px] text-ink-950">
                Ver detalle
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      {/* Modal de confirmación de rechazo */}
      <Modal
        visible={isMounted}
        animationType="none"
        transparent
        onRequestClose={() => !isBusy && setIsRejectModalVisible(false)}
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
