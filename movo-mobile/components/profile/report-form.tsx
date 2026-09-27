import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { ReportReason } from "@movo/shared/dist/types/user";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useReportUser } from "../../src/hooks/use-moderation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { REPORT_REASON_OPTIONS } from "../../src/lib/report-format";
import { ErrorBanner } from "../ui/error-banner";
import { TextField } from "../ui/text-field";

export interface ReportFormProps {
  userId: string;
  /** Reporte creado: `useReportUser` ya lo dejó en el caché de `usePendingReport`. */
  onCreated: () => void;
  /** 409 `REPORT_ALREADY_PENDING`: ya había un reporte en revisión. */
  onAlreadyPending: () => void;
  testID?: string;
}

/** MOVO-175: formulario de un reporte nuevo (motivo obligatorio + detalle opcional). */
export function ReportForm({ userId, onCreated, onAlreadyPending, testID = "report-form" }: ReportFormProps) {
  const colors = useThemeColors();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reportMutation = useReportUser(userId);

  async function handleSubmit() {
    if (!reason) {
      setErrorMessage("Elegí un motivo para continuar.");
      return;
    }
    setErrorMessage(null);
    try {
      await reportMutation.mutateAsync({ reason, details: details.trim() || undefined });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.code === "REPORT_ALREADY_PENDING") {
        onAlreadyPending();
        return;
      }
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos enviar el reporte. Probá de nuevo.", {
          RATE_LIMIT_EXCEEDED: "Hiciste demasiados reportes hoy. Probá de nuevo mañana.",
        }),
      );
    }
  }

  return (
    <View testID={testID}>
      <Text className="mb-5 font-sans text-small text-fg-3">
        El equipo de Movo revisa cada reporte. Contanos qué pasó.
      </Text>

      <Text className="mb-2 font-sans-semibold text-caption uppercase text-fg-3">Motivo</Text>
      <View className="mb-5 gap-2">
        {REPORT_REASON_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            testID={`${testID}-reason-${option.value}`}
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
              {reason === option.value ? <View className="h-2 w-2 rounded-full bg-fg" /> : null}
            </View>
            <Text className="font-sans text-[14px] text-fg">{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <TextField
        testID={`${testID}-details-input`}
        label="Detalles (opcional)"
        placeholder="Contanos más si hace falta..."
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={500}
      />

      {errorMessage ? (
        <View className="mt-3">
          <ErrorBanner testID={`${testID}-error`} message={errorMessage} />
        </View>
      ) : null}

      <Pressable
        testID={`${testID}-submit`}
        onPress={() => void handleSubmit()}
        disabled={reportMutation.isPending}
        className={`mt-5 w-full flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3.5 ${
          reportMutation.isPending ? "opacity-70" : ""
        }`}
      >
        {reportMutation.isPending ? <ActivityIndicator size="small" color={colors.bg} /> : null}
        <Text className="font-sans-semibold text-body text-bg">Enviar reporte</Text>
      </Pressable>
    </View>
  );
}
