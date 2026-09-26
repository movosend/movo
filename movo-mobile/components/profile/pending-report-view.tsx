import type { UserReportSummary } from "@movo/shared/dist/types/user";
import { useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, View } from "react-native";
import { useAddReportEntry } from "../../src/hooks/use-moderation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { formatRatingDate } from "../../src/lib/profile-format";
import { reportReasonLabel } from "../../src/lib/report-format";
import { ErrorBanner } from "../ui/error-banner";
import { TextField } from "../ui/text-field";

export interface PendingReportViewProps {
  userId: string;
  fullName: string;
  report: UserReportSummary;
  /** Aviso arriba del reporte, ej. cuando se intentó reportar de nuevo y ya existía. */
  notice?: string | null;
  /** Texto con el que arranca el campo de "Sumar información". */
  initialDetails?: string;
  onClose: () => void;
  /** Deshabilita la acción mientras hay otra mutación del menú en curso. */
  disabled?: boolean;
  testID?: string;
}

/**
 * MOVO-175: el reporte propio en revisión sobre otro usuario. Muestra lo ya enviado
 * (motivo, detalle y las entradas sumadas después) y deja agregar información nueva
 * como una entrada más: nunca edita lo anterior, así el equipo de Movo ve qué se dijo
 * y cuándo.
 */
export function PendingReportView({
  userId,
  fullName,
  report,
  notice,
  initialDetails = "",
  onClose,
  disabled = false,
  testID = "profile-pending-report",
}: PendingReportViewProps) {
  const colors = useThemeColors();
  const [details, setDetails] = useState(initialDetails);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const addEntryMutation = useAddReportEntry(userId);

  const canSubmit = details.trim().length > 0 && !addEntryMutation.isPending && !disabled;

  async function handleAddEntry() {
    if (!details.trim()) return;
    setErrorMessage(null);
    setJustAdded(false);
    try {
      await addEntryMutation.mutateAsync(details.trim());
      setDetails("");
      setJustAdded(true);
      Keyboard.dismiss();
    } catch (err) {
      // Mismo motivo que el formulario de reporte: con el teclado abierto el sheet
      // sube y el error quedaría fuera de la pantalla.
      Keyboard.dismiss();
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos sumar la información. Probá de nuevo.", {
          RATE_LIMIT_EXCEEDED: "Hiciste demasiados reportes hoy. Probá de nuevo mañana.",
        }),
      );
    }
  }

  return (
    <View className="px-5 pt-5" testID={testID}>
      <Text className="mb-1 font-sans-semibold text-h3 text-fg">Tu reporte sobre {fullName}</Text>
      <Text className="mb-4 font-sans text-small text-fg-3">
        Está en revisión. El equipo de Movo lo va a mirar; si te acordás de algo más, sumalo acá.
      </Text>

      {notice ? (
        <View className="mb-3 rounded-lg bg-bg-mute px-3.5 py-3" testID={`${testID}-notice`}>
          <Text className="font-sans text-small text-fg-2">{notice}</Text>
        </View>
      ) : null}

      <ScrollView className="mb-3" style={{ maxHeight: 260 }} testID={`${testID}-history`}>
        <View className="gap-2.5">
          <View className="rounded-lg border border-border px-3.5 py-3">
            <View className="mb-1 flex-row items-center justify-between gap-2">
              <Text className="font-sans-semibold text-[14px] text-fg" testID={`${testID}-reason`}>
                {reportReasonLabel(report.reason)}
              </Text>
              <Text className="font-sans text-caption text-fg-3">{formatRatingDate(report.createdAt)}</Text>
            </View>
            <Text className="font-sans text-small text-fg-2" testID={`${testID}-details`}>
              {report.details ?? "Sin detalles."}
            </Text>
          </View>

          {report.entries.map((entry) => (
            <View
              key={entry.id}
              className="rounded-lg border border-border px-3.5 py-3"
              testID={`${testID}-entry-${entry.id}`}
            >
              <View className="mb-1 flex-row items-center justify-between gap-2">
                <Text className="font-sans-medium text-caption text-fg-3">Agregaste</Text>
                <Text className="font-sans text-caption text-fg-3">{formatRatingDate(entry.createdAt)}</Text>
              </View>
              <Text className="font-sans text-small text-fg-2">{entry.details}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <TextField
        testID={`${testID}-entry-input`}
        label="Sumar información"
        placeholder="Contanos lo que no dijiste antes..."
        value={details}
        onChangeText={(text) => {
          setDetails(text);
          setJustAdded(false);
        }}
        multiline
        maxLength={500}
      />

      {justAdded ? (
        <Text className="mt-2 font-sans text-small text-success-700" testID={`${testID}-entry-added`}>
          Sumamos tu información al reporte.
        </Text>
      ) : null}

      {errorMessage ? (
        <View className="mt-3">
          <ErrorBanner testID={`${testID}-error`} message={errorMessage} />
        </View>
      ) : null}

      <View className="mt-2 flex-col gap-2.5 pb-4 pt-2">
        <Pressable
          testID={`${testID}-add-button`}
          onPress={() => void handleAddEntry()}
          disabled={!canSubmit}
          accessibilityState={{ disabled: !canSubmit }}
          className={`w-full flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3.5 ${
            canSubmit ? "" : "opacity-50"
          }`}
        >
          {addEntryMutation.isPending ? <ActivityIndicator size="small" color={colors.bg} /> : null}
          <Text className="font-sans-semibold text-body text-bg">Agregar al reporte</Text>
        </Pressable>
        <Pressable
          testID={`${testID}-close-button`}
          onPress={onClose}
          disabled={addEntryMutation.isPending}
          className="w-full items-center justify-center py-2.5"
        >
          <Text className="font-sans-medium text-body text-fg-2">Cerrar</Text>
        </Pressable>
      </View>
    </View>
  );
}
