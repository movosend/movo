import { ApiError } from "@movo/shared/dist/errors/api-error";
import { MenuView } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import { MoreVertical } from "lucide-react-native";
import { useColorScheme } from "nativewind";
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
import Animated from "react-native-reanimated";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { useCancelShipment } from "../../src/hooks/use-shipments";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { ErrorBanner } from "../ui/error-banner";
import { TextField } from "../ui/text-field";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const CANCEL_ACTION_ID = "cancel-shipment";

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
 * Botón de acciones del emisor (MOVO-29): un ícono de tres puntos en el header
 * (junto a `ShipmentStatusBadge`) que abre el menú desplegable **nativo** de la
 * plataforma (`UIMenu` en iOS 14+/`PopupMenu` en Android, vía
 * `@react-native-menu/menu`) — tercera vuelta de feedback tras dos versiones
 * caseras: una barra fija al pie (rechazada, "esa franja debería estar libre") y
 * un ícono que abría el modal de cancelación directo (rechazado, "poco intuitivo").
 * Un desplegable hecho a mano (`Modal` + card con blur) todavía se sentía "berreta"
 * — con dev client ya andando, se optó por el componente nativo real en vez de
 * seguir afinando CSS. Hoy con una sola acción (`Cancelar envío`, atributo
 * `destructive` nativo — rojo automático en iOS, `titleColor` explícito en
 * Android), pero el array de `actions` ya admite sumar más sin rehacer nada.
 *
 * - Elegir "Cancelar envío" abre el modal de confirmación (motivo opcional, AC5,
 *   advertencia de irreversibilidad) — ese modal sigue siendo un `Modal` propio de
 *   RN, no nativo, porque necesita un campo de texto libre.
 * - Deshabilita el ícono (`pointerEvents="none"` + opacidad) durante mutación en
 *   vuelo para prevenir double tap — `MenuView` no expone una prop `disabled`.
 * - Maneja errores 403/404/409 (dos códigos distintos)/genérico con mensajes
 *   específicos, mostrados adentro del propio modal (no se cierra ante un error —
 *   así el usuario ve el mensaje sin perder el motivo ya escrito); un 409 además
 *   dispara `onRefetch?.()` porque el estado real cambió de lo que la pantalla
 *   asumía (carrera con una asignación concurrente, por ejemplo).
 */
export function SenderActionsBar({
  shipmentId,
  onRefetch,
  testID,
}: SenderActionsBarProps) {
  const cancelMutation = useCancelShipment();
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();

  const [isCancelModalVisible, setIsCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isMounted, backdropStyle, sheetStyle } =
    useSheetAnimation(isCancelModalVisible);

  const isBusy = cancelMutation.isPending;

  const handleCancelRowPress = () => {
    setErrorMessage(null);
    setCancelReason("");
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
    }
  };

  return (
    <View testID={testID}>
      <View
        testID={
          testID ? `${testID}-menu-wrapper` : "sender-actions-menu-wrapper"
        }
        pointerEvents={isBusy ? "none" : "auto"}
        style={{ opacity: isBusy ? 0.5 : 1 }}
      >
        <MenuView
          testID={testID ? `${testID}-menu` : "sender-actions-menu"}
          shouldOpenOnLongPress={false}
          isAnchoredToRight
          themeVariant={colorScheme === "dark" ? "dark" : "light"}
          onOpenMenu={() =>
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          }
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === CANCEL_ACTION_ID) {
              handleCancelRowPress();
            }
          }}
          actions={[
            {
              id: CANCEL_ACTION_ID,
              title: "Cancelar envío",
              titleColor: "#E5484D",
              attributes: { destructive: true },
              image: Platform.select({
                ios: "trash",
                android: "ic_menu_delete",
              }),
              imageColor: "#E5484D",
            },
          ]}
        >
          <View
            testID={
              testID ? `${testID}-menu-button` : "sender-actions-menu-button"
            }
            accessibilityLabel="Más acciones"
            className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          >
            <MoreVertical size={18} color={colors.fg1} strokeWidth={2} />
          </View>
        </MenuView>
      </View>

      {/* Modal de confirmación de cancelación */}
      <Modal
        visible={isMounted}
        animationType="none"
        transparent
        onRequestClose={() => setIsCancelModalVisible(false)}
        testID={testID ? `${testID}-cancel-modal` : "sender-cancel-modal"}
      >
        <SafeAreaProvider
          initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}
        >
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View className="flex-1">
              {/* Overlay: solo hace fade (nunca se desliza) — separado del slide de la
               * hoja para no repetir el bug de `animationType="slide"` de RN Modal
               * (ver `useSheetAnimation`). */}
              <Animated.View
                style={[StyleSheet.absoluteFill, backdropStyle]}
              >
                <Pressable
                  testID={
                    testID
                      ? `${testID}-cancel-modal-backdrop`
                      : "sender-cancel-modal-backdrop"
                  }
                  onPress={() => !isBusy && setIsCancelModalVisible(false)}
                  className="flex-1 bg-black/40"
                />
              </Animated.View>
              {/* `pointerEvents="box-none"`: el espacio vacío arriba de la hoja no
               * debe tapar el overlay de atrás, solo la hoja en sí es un target. */}
              <View className="flex-1 justify-end" pointerEvents="box-none">
                <Animated.View style={sheetStyle}>
                  <SafeAreaView
                    className="rounded-t-2xl bg-bg"
                    edges={["bottom"]}
                  >
                    <View className="px-5 pt-5">
                      <Text className="mb-1 font-sans-semibold text-h3 text-fg">
                        ¿Cancelar este envío?
                      </Text>
                      <Text className="mb-4 font-sans text-small text-fg-3">
                        Esta acción es irreversible. El envío quedará cancelado
                        y, si ya tenía ofertas, cada transportista será
                        notificado.
                      </Text>

                      {errorMessage ? (
                        <View className="mb-4">
                          <ErrorBanner
                            testID={
                              testID
                                ? `${testID}-error`
                                : "sender-actions-error"
                            }
                            message={errorMessage}
                          />
                        </View>
                      ) : null}

                      <TextField
                        testID={
                          testID
                            ? `${testID}-cancel-reason-input`
                            : "sender-cancel-reason-input"
                        }
                        label="Motivo de la cancelación (opcional)"
                        placeholder="Ej: Me equivoqué de dirección, ya no lo necesito..."
                        value={cancelReason}
                        onChangeText={setCancelReason}
                        maxLength={500}
                      />

                      <View className="mt-2 flex-col gap-2.5 pb-4 pt-2">
                        <Pressable
                          testID={
                            testID
                              ? `${testID}-cancel-confirm-button`
                              : "sender-cancel-confirm-button"
                          }
                          onPress={() => void handleConfirmCancel()}
                          disabled={cancelMutation.isPending}
                          className={`w-full flex-row items-center justify-center gap-2 rounded-lg bg-danger-500 py-3.5 ${
                            cancelMutation.isPending ? "opacity-70" : ""
                          }`}
                        >
                          {cancelMutation.isPending ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : null}
                          <Text className="font-sans-semibold text-body text-white">
                            Confirmar cancelación
                          </Text>
                        </Pressable>

                        <Pressable
                          testID={
                            testID
                              ? `${testID}-cancel-dismiss-button`
                              : "sender-cancel-dismiss-button"
                          }
                          onPress={() => setIsCancelModalVisible(false)}
                          disabled={cancelMutation.isPending}
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
