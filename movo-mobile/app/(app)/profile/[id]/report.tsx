import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, WifiOff } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
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
import { useBlockUser, usePendingReport } from "../../../../src/hooks/use-moderation";
import { usePublicProfile } from "../../../../src/hooks/use-profile";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";

/** Cuánto queda visible el aviso flotante (mockup 1A). */
const TOAST_DURATION_MS = 2400;

/**
 * MOVO-175: "mi reporte sobre esta persona", en un solo lugar. Sin reporte en revisión
 * muestra el formulario; con uno, el hilo del reporte (MOVO-256, mockup 1A): estado,
 * lo enviado con cada cosa sumada después, bloquear como acción secundaria y el
 * composer fijo abajo. Un 409 `REPORT_ALREADY_PENDING` (reporte hecho desde otro
 * dispositivo, o un reintento cuyo primer envío sí llegó) muestra el reporte existente
 * con un aviso.
 */
export default function ReportUserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const profileQuery = usePublicProfile(id);
  const reportQuery = usePendingReport(id);
  const blockMutation = useBlockUser(id);

  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profile = profileQuery.data;
  const report = reportQuery.data ?? null;
  const fullName = profile?.fullName ?? "esta persona";
  const isLoading = profileQuery.isLoading || reportQuery.isLoading;
  // Fix de review (PR #193): el reporte propio sobrevive a la baja de cuenta del
  // reportado (getPendingReport, moderation.service.ts) -- un 404 de `GET /users/:id`
  // sobre una cuenta ya borrada no debería tapar un reporte que sí cargó bien. Solo
  // bloquea la pantalla un error del que no hay forma de recuperarse: el reporte en sí
  // falló, o el reporte falló Y el perfil también (no hay ni nombre ni reporte que
  // mostrar).
  const isError = !isLoading && (reportQuery.isError || (profileQuery.isError && !report));

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace(`/profile/${id}`);
  }

  function handleAlreadyPending() {
    setNotice(`Ya tenías un reporte en revisión sobre ${fullName}. No enviamos uno nuevo.`);
  }

  // Fix de review (PR #193): tras el 409, `notice` queda seteado y `report` en `null`
  // hasta que el `invalidateQueries` de `useReportUser` trae el reporte real. Si en ese
  // intervalo el reporte se resolvió (pasó a `reviewed`/`dismissed`), el refetch
  // devuelve `null` y sin este efecto la pantalla se quedaba en el spinner del branch
  // "409 recibido" para siempre -- nunca vuelve a mostrar el formulario ni ningún otro
  // estado. Una vez que el refetch de `reportQuery` termina (no está en vuelo) y sigue
  // sin reporte, se limpia el aviso para que el flujo caiga al `ReportForm`.
  useEffect(() => {
    if (notice && !report && !reportQuery.isFetching && reportQuery.isFetched) {
      setNotice(null);
    }
  }, [notice, report, reportQuery.isFetching, reportQuery.isFetched]);

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
              onSuccess: () => showToast(`Bloqueaste a ${fullName}.`),
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
    <SafeAreaView className="flex-1 bg-bg" edges={report ? ["top"] : ["top", "bottom"]}>
      <View
        className={`flex-row items-center gap-3 px-5 pb-3.5 pt-2.5 ${report ? "border-b border-border" : ""}`}
      >
        <Pressable
          testID="report-screen-back"
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          className="h-10 w-10 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={20} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View className="min-w-0 flex-1">
          <Text className="font-sans-semibold text-[18px] leading-[22px] tracking-[-0.18px] text-fg" numberOfLines={1}>
            {isLoading ? "" : title}
          </Text>
          {report && !isLoading ? (
            <Text className="font-sans text-small text-fg-3" numberOfLines={1} testID="report-screen-subtitle">
              Sobre {fullName}
            </Text>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {isLoading ? (
          <View className="items-center py-16" testID="report-screen-loading">
            <ActivityIndicator color={colors.fg3} />
          </View>
        ) : isError ? (
          <View className="items-center gap-2 px-8 py-16" testID="report-screen-error">
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
          <PendingReportView
            userId={id}
            report={report}
            reportedName={fullName}
            notice={notice}
            isBlocked={profile?.isBlockedByMe ?? false}
            blockPending={blockMutation.isPending}
            onBlock={confirmBlock}
            onEntryAdded={() => showToast("Lo sumamos a tu reporte.")}
            testID="report-screen-pending"
          />
        ) : notice ? (
          // 409 recibido, el reporte existente todavía no llegó.
          <View className="items-center py-16">
            <ActivityIndicator color={colors.fg3} />
          </View>
        ) : (
          <ScrollView
            testID="report-screen-content"
            className="flex-1"
            contentContainerClassName="px-5 pb-10 pt-2"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ReportForm
              userId={id}
              onAlreadyPending={handleAlreadyPending}
              testID="report-screen-form"
            />
          </ScrollView>
        )}

        {/* Aviso flotante (mockup 1A), debajo del header. */}
        {toast ? (
          <View
            testID="report-screen-toast"
            pointerEvents="none"
            className="absolute left-4 right-4 top-3 flex-row items-center gap-2.5 rounded-[14px] bg-ink-950/90 px-3.5 py-3"
            style={{ shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}
          >
            <View className="h-2 w-2 rounded-full bg-lime-500" />
            <Text className="font-sans-medium text-[14px] text-white">{toast}</Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
