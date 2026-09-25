import { ReportReason } from "@movo/shared/dist/types/user";
import { MenuView } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import { MoreVertical } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useState } from "react";
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { useBlockUser, useReportUser, useUnblockUser } from "../../src/hooks/use-moderation";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { ErrorBanner } from "../ui/error-banner";
import { TextField } from "../ui/text-field";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const REPORT_ACTION_ID = "report-user";
const BLOCK_ACTION_ID = "block-user";
const UNBLOCK_ACTION_ID = "unblock-user";

const REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: ReportReason.HARASSMENT, label: "Acoso o maltrato" },
  { value: ReportReason.NO_SHOW, label: "No se presentó" },
  { value: ReportReason.DAMAGED_PACKAGE, label: "Paquete dañado" },
  { value: ReportReason.PAYMENT_ISSUE, label: "Problema con el pago" },
  { value: ReportReason.OTHER, label: "Otro motivo" },
];

export interface ProfileActionsMenuProps {
  userId: string;
  fullName: string;
  /** `PublicProfile.isBlockedByMe` — alterna la acción entre "Bloquear" y "Desbloquear". */
  isBlockedByMe?: boolean;
  /** Confirmación de bloquear/desbloquear, para que la pantalla la muestre con `SuccessBanner`. */
  onActionSuccess?: (message: string) => void;
  testID?: string;
}

/**
 * Menú "Reportar/Bloquear" del rediseño de perfil (MOVO-175, ADR-026). Reusa el patrón
 * exacto de `MenuView` de `components/shipments/sender-actions-bar.tsx` (MOVO-29):
 * menú nativo (`UIMenu`/`PopupMenu`) para las dos acciones, `Modal` propio solo
 * para el motivo de reporte (necesita texto libre), y `Alert.alert` nativo como
 * último paso de la confirmación de bloqueo (mismo criterio que la baja de cuenta,
 * MOVO-136: el diálogo nativo cierra la acción, no es el único paso). Después de
 * reportar, el sheet pasa a un estado de éxito que ofrece bloquear también.
 */
export function ProfileActionsMenu({
  userId,
  fullName,
  isBlockedByMe = false,
  onActionSuccess,
  testID,
}: ProfileActionsMenuProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();

  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReportSubmitted, setIsReportSubmitted] = useState(false);
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(isReportModalVisible);

  const reportMutation = useReportUser(userId, {
    onSuccess: () => setIsReportSubmitted(true),
  });
  const blockMutation = useBlockUser(userId);
  const unblockMutation = useUnblockUser();

  const isBusy = reportMutation.isPending || blockMutation.isPending || unblockMutation.isPending;

  function resolveErrorMessage(error: unknown): string {
    return friendlyErrorMessage(error, "No pudimos completar la acción. Probá de nuevo.", {
      RATE_LIMIT_EXCEEDED: "Hiciste demasiados reportes hoy. Probá de nuevo mañana.",
    });
  }

  function openReportModal() {
    setErrorMessage(null);
    setReason(null);
    setDetails("");
    setIsReportSubmitted(false);
    setIsReportModalVisible(true);
  }

  /** Con el teclado abierto el sheet sube y su parte superior queda fuera de la
   * pantalla: se cierra el teclado para que el formulario completo (y el error) vuelva
   * a verse. El banner además vive junto al botón, en la zona que siempre queda
   * visible sobre el teclado. */
  function showReportError(message: string) {
    Keyboard.dismiss();
    setErrorMessage(message);
  }

  async function handleConfirmReport() {
    if (!reason) {
      showReportError("Elegí un motivo para continuar.");
      return;
    }
    try {
      await reportMutation.mutateAsync({ reason, details: details.trim() || undefined });
    } catch (err) {
      showReportError(resolveErrorMessage(err));
    }
  }

  function confirmBlock() {
    Alert.alert(
      `¿Bloquear a ${fullName}?`,
      "No se van a ver en sus listados y no van a poder crear envíos ni ofertas nuevas entre ustedes. " +
        "Los envíos que ya tengan en curso siguen normalmente.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Bloquear",
          style: "destructive",
          onPress: () => {
            blockMutation.mutate(undefined, {
              onSuccess: () => {
                setIsReportModalVisible(false);
                onActionSuccess?.(`Bloqueaste a ${fullName}.`);
              },
              onError: (err) => Alert.alert("No pudimos bloquear", resolveErrorMessage(err)),
            });
          },
        },
      ],
    );
  }

  function confirmUnblock() {
    Alert.alert(`¿Desbloquear a ${fullName}?`, "Van a poder volver a verse y crear envíos entre ustedes.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Desbloquear",
        onPress: () => {
          unblockMutation.mutate(userId, {
            onSuccess: () => onActionSuccess?.(`Desbloqueaste a ${fullName}.`),
            onError: (err) => Alert.alert("No pudimos desbloquear", resolveErrorMessage(err)),
          });
        },
      },
    ]);
  }

  return (
    <View testID={testID}>
      <View
        testID={testID ? `${testID}-menu-wrapper` : "profile-actions-menu-wrapper"}
        pointerEvents={isBusy ? "none" : "auto"}
        style={{ opacity: isBusy ? 0.5 : 1 }}
      >
        <MenuView
          testID={testID ? `${testID}-menu` : "profile-actions-menu"}
          shouldOpenOnLongPress={false}
          isAnchoredToRight
          themeVariant={colorScheme === "dark" ? "dark" : "light"}
          onOpenMenu={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === REPORT_ACTION_ID) openReportModal();
            if (nativeEvent.event === BLOCK_ACTION_ID) confirmBlock();
            if (nativeEvent.event === UNBLOCK_ACTION_ID) confirmUnblock();
          }}
          actions={[
            {
              id: REPORT_ACTION_ID,
              title: `Reportar a ${fullName}`,
              image: Platform.select({ ios: "flag", android: "ic_menu_report_image" }),
              // Sin `imageColor` explícito el ícono queda sin tinte (invisible en la
              // práctica) — a diferencia de "Bloquear", que sí lo tenía por ser
              // destructivo. `colors.fg1` para que se vea igual que el texto de la
              // fila en los dos temas.
              imageColor: colors.fg1,
            },
            isBlockedByMe
              ? {
                  id: UNBLOCK_ACTION_ID,
                  title: "Desbloquear",
                  image: Platform.select({ ios: "hand.raised.slash", android: "ic_menu_revert" }),
                  imageColor: colors.fg1,
                }
              : {
                  id: BLOCK_ACTION_ID,
                  title: "Bloquear",
                  titleColor: "#E5484D",
                  attributes: { destructive: true },
                  image: Platform.select({ ios: "hand.raised", android: "ic_menu_close_clear_cancel" }),
                  imageColor: "#E5484D",
                },
          ]}
        >
          <View
            testID={testID ? `${testID}-menu-button` : "profile-actions-menu-button"}
            accessibilityLabel="Más acciones"
            className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          >
            <MoreVertical size={18} color={colors.fg1} strokeWidth={2} />
          </View>
        </MenuView>
      </View>

      <Modal
        visible={isMounted}
        animationType="none"
        transparent
        onRequestClose={() => setIsReportModalVisible(false)}
        testID={testID ? `${testID}-report-modal` : "profile-report-modal"}
      >
        <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
          <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
              <Pressable
                testID={testID ? `${testID}-report-modal-backdrop` : "profile-report-modal-backdrop"}
                onPress={() => !isBusy && setIsReportModalVisible(false)}
                className="flex-1 bg-black/40"
              />
            </Animated.View>
            <View className="flex-1 justify-end" pointerEvents="box-none">
              <Animated.View style={sheetStyle}>
                <SafeAreaView className="rounded-t-2xl bg-bg" edges={["bottom"]}>
                  {isReportSubmitted ? (
                    <View className="px-5 pt-5" testID={testID ? `${testID}-report-success` : "profile-report-success"}>
                      <Text className="mb-1 font-sans-semibold text-h3 text-fg">Gracias por avisarnos</Text>
                      <Text className="mb-4 font-sans text-small text-fg-3">
                        El equipo de Movo va a revisar tu reporte.
                        {isBlockedByMe ? "" : ` Si no querés cruzarte más con ${fullName}, también podés bloquearlo.`}
                      </Text>
                      <View className="flex-col gap-2.5 pb-4 pt-2">
                        {isBlockedByMe ? null : (
                          <Pressable
                            testID={testID ? `${testID}-report-success-block-button` : "profile-report-success-block-button"}
                            onPress={confirmBlock}
                            disabled={blockMutation.isPending}
                            className={`w-full flex-row items-center justify-center gap-2 rounded-lg bg-danger-500 py-3.5 ${
                              blockMutation.isPending ? "opacity-70" : ""
                            }`}
                          >
                            {blockMutation.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                            <Text className="font-sans-semibold text-body text-white">Bloquear a {fullName}</Text>
                          </Pressable>
                        )}
                        <Pressable
                          testID={testID ? `${testID}-report-success-done-button` : "profile-report-success-done-button"}
                          onPress={() => setIsReportModalVisible(false)}
                          disabled={blockMutation.isPending}
                          className="w-full items-center justify-center py-2.5"
                        >
                          <Text className="font-sans-medium text-body text-fg-2">Listo</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                  <View className="px-5 pt-5">
                    <Text className="mb-1 font-sans-semibold text-h3 text-fg">
                      Reportar a {fullName}
                    </Text>
                    <Text className="mb-4 font-sans text-small text-fg-3">
                      El equipo de Movo revisa cada reporte. Contanos qué pasó.
                    </Text>

                    <View className="mb-3 gap-2">
                      {REASON_OPTIONS.map((option) => (
                        <Pressable
                          key={option.value}
                          testID={testID ? `${testID}-reason-${option.value}` : undefined}
                          onPress={() => setReason(option.value)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: reason === option.value }}
                          className={`flex-row items-center gap-2.5 rounded-lg border px-3.5 py-3 ${
                            reason === option.value ? "border-fg bg-bg-mute" : "border-border"
                          }`}
                        >
                          <View
                            className={`h-4 w-4 items-center justify-center rounded-full border-[1.5px] ${
                              reason === option.value ? "border-fg" : "border-border-strong"
                            }`}
                          >
                            {reason === option.value ? (
                              <View className="h-2 w-2 rounded-full bg-fg" />
                            ) : null}
                          </View>
                          <Text className="font-sans text-[14px] text-fg">{option.label}</Text>
                        </Pressable>
                      ))}
                    </View>

                    <TextField
                      testID={testID ? `${testID}-report-details-input` : "profile-report-details-input"}
                      label="Detalles (opcional)"
                      placeholder="Contanos más si hace falta..."
                      value={details}
                      onChangeText={setDetails}
                      multiline
                      maxLength={500}
                    />

                    {errorMessage ? (
                      <View className="mt-3">
                        <ErrorBanner
                          testID={testID ? `${testID}-report-error` : "profile-report-error"}
                          message={errorMessage}
                        />
                      </View>
                    ) : null}

                    <View className="mt-2 flex-col gap-2.5 pb-4 pt-2">
                      <Pressable
                        testID={testID ? `${testID}-report-confirm-button` : "profile-report-confirm-button"}
                        onPress={() => void handleConfirmReport()}
                        disabled={reportMutation.isPending}
                        className={`w-full flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3.5 ${
                          reportMutation.isPending ? "opacity-70" : ""
                        }`}
                      >
                        {reportMutation.isPending ? <ActivityIndicator size="small" color={colors.bg} /> : null}
                        <Text className="font-sans-semibold text-body text-bg">Enviar reporte</Text>
                      </Pressable>
                      <Pressable
                        testID={testID ? `${testID}-report-dismiss-button` : "profile-report-dismiss-button"}
                        onPress={() => setIsReportModalVisible(false)}
                        disabled={reportMutation.isPending}
                        className="w-full items-center justify-center py-2.5"
                      >
                        <Text className="font-sans-medium text-body text-fg-2">Cancelar</Text>
                      </Pressable>
                    </View>
                  </View>
                  )}
                </SafeAreaView>
              </Animated.View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}
