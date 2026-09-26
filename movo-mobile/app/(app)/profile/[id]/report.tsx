import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, WifiOff } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PendingReportView } from "../../../../components/profile/pending-report-view";
import { ReportForm } from "../../../../components/profile/report-form";
import { SuccessBanner } from "../../../../components/ui/success-banner";
import { useBlockUser, usePendingReport } from "../../../../src/hooks/use-moderation";
import { usePublicProfile } from "../../../../src/hooks/use-profile";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";

/**
 * MOVO-175: "mi reporte sobre esta persona", en un solo lugar. Sin reporte en revisión
 * muestra el formulario; con uno, lo enviado y el campo para sumar información. Al
 * crear el reporte la misma pantalla pasa a mostrarlo (con la opción de bloquear). Un
 * 409 `REPORT_ALREADY_PENDING` (reporte hecho desde otro dispositivo, o un reintento
 * cuyo primer envío sí llegó) muestra el reporte existente con un aviso.
 * Antes era un sheet del menú del perfil; el historial de entradas lo dejó chico.
 */
export default function ReportUserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const profileQuery = usePublicProfile(id);
  const reportQuery = usePendingReport(id);
  const blockMutation = useBlockUser(id);

  /** El reporte se creó en esta visita: se agradece y se ofrece bloquear. */
  const [justCreated, setJustCreated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const profile = profileQuery.data;
  const report = reportQuery.data ?? null;
  const fullName = profile?.fullName ?? "esta persona";
  const isLoading = profileQuery.isLoading || reportQuery.isLoading;
  const isError = !isLoading && (profileQuery.isError || reportQuery.isError);

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace(`/profile/${id}`);
  }

  function handleAlreadyPending() {
    setNotice(`Ya tenías un reporte en revisión sobre ${fullName}. No enviamos uno nuevo.`);
  }

  function confirmBlock() {
    Alert.alert(
      `¿Bloquear a ${fullName}?`,
      "Podés revertirlo cuando quieras desde Configuración › Cuenta y seguridad › Usuarios bloqueados.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Bloquear",
          style: "destructive",
          onPress: () =>
            blockMutation.mutate(undefined, {
              onSuccess: () => setSuccessMessage(`Bloqueaste a ${fullName}.`),
              onError: (err) =>
                Alert.alert(
                  "No pudimos bloquear",
                  friendlyErrorMessage(err, "No pudimos completar la acción. Probá de nuevo."),
                ),
            }),
        },
      ],
    );
  }

  const title = report ? "Tu reporte" : `Reportar a ${fullName}`;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="report-screen-back"
          onPress={handleBack}
          accessibilityRole="button"
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="flex-1 font-sans-semibold text-h3 text-fg" numberOfLines={1}>
          {isLoading ? "" : title}
        </Text>
      </View>

      {successMessage ? (
        <View className="px-5">
          <SuccessBanner
            testID="report-screen-success"
            message={successMessage}
            onDismiss={() => setSuccessMessage(null)}
          />
        </View>
      ) : null}

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          testID="report-screen-content"
          className="flex-1"
          contentContainerClassName="px-5 pb-10 pt-2"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? (
            <View className="items-center py-16" testID="report-screen-loading">
              <ActivityIndicator color={colors.fg3} />
            </View>
          ) : isError ? (
            <View className="items-center gap-2 px-3 py-16" testID="report-screen-error">
              <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
              <Text className="text-center font-sans text-body text-fg-2">No pudimos cargar tu reporte.</Text>
              <Text
                testID="report-screen-retry"
                onPress={() => {
                  void profileQuery.refetch();
                  void reportQuery.refetch();
                }}
                className="font-sans-medium text-small text-fg"
              >
                Reintentar
              </Text>
            </View>
          ) : report ? (
            <>
              {justCreated ? (
                <View className="mb-6 rounded-lg bg-bg-mute px-4 py-4" testID="report-screen-created">
                  <Text className="mb-1 font-sans-semibold text-body text-fg">Gracias por avisarnos</Text>
                  <Text className="font-sans text-small text-fg-2">
                    Recibimos tu reporte.
                    {profile?.isBlockedByMe ? "" : ` Si no querés cruzarte más con ${fullName}, también podés bloquearlo.`}
                  </Text>
                  {profile?.isBlockedByMe ? null : (
                    <Pressable
                      testID="report-screen-block-button"
                      onPress={confirmBlock}
                      disabled={blockMutation.isPending}
                      className={`mt-3.5 w-full flex-row items-center justify-center gap-2 rounded-lg bg-danger-500 py-3 ${
                        blockMutation.isPending ? "opacity-70" : ""
                      }`}
                    >
                      {blockMutation.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                      <Text className="font-sans-semibold text-body text-white">Bloquear a {fullName}</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
              <PendingReportView
                userId={id}
                report={report}
                notice={notice}
                testID="report-screen-pending"
              />
            </>
          ) : notice ? (
            // 409 recibido, el reporte existente todavía no llegó.
            <View className="items-center py-16">
              <ActivityIndicator color={colors.fg3} />
            </View>
          ) : (
            <ReportForm
              userId={id}
              onCreated={() => setJustCreated(true)}
              onAlreadyPending={handleAlreadyPending}
              testID="report-screen-form"
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
