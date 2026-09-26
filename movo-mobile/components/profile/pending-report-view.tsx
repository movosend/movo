import type { UserReportPhoto, UserReportSummary } from "@movo/shared/dist/types/user";
import { ArrowUp, Ban, ChevronRight, ImagePlus } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAddReportEntry } from "../../src/hooks/use-moderation";
import { useReportPhotos } from "../../src/hooks/use-report-photos";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { formatReportTimestamp, reportReasonLabel } from "../../src/lib/report-format";
import { ErrorBanner } from "../ui/error-banner";
import { GridPattern } from "../ui/grid-pattern";
import { ReportDraftPhotoRow, ReportPhotoGrid } from "./report-photos";

export interface PendingReportViewProps {
  userId: string;
  report: UserReportSummary;
  /** Nombre completo del reportado ("esta persona" si el perfil no cargó). */
  reportedName: string;
  /** Aviso arriba del historial, ej. cuando se intentó reportar de nuevo y ya existía. */
  notice?: string | null;
  isBlocked: boolean;
  blockPending: boolean;
  onBlock: () => void;
  /** Se sumó una entrada: la pantalla muestra el aviso flotante. */
  onEntryAdded: () => void;
  testID?: string;
}

interface TimelineItem {
  id: string;
  kind: string;
  when: string;
  reason: string | null;
  text: string | null;
  photos: UserReportPhoto[];
}

/**
 * `?? []` en las fotos: el contrato las declara obligatorias (MOVO-256), pero un
 * backend todavía sin desplegar (dev antes del merge, un contenedor local viejo) las
 * omite. Sin esto la pantalla se rompía en vez de mostrar el reporte sin fotos.
 */
function toTimeline(report: UserReportSummary): TimelineItem[] {
  return [
    {
      id: report.id,
      kind: "Reporte inicial",
      when: formatReportTimestamp(report.createdAt),
      reason: reportReasonLabel(report.reason),
      text: report.details,
      photos: report.photos ?? [],
    },
    ...report.entries.map((entry) => ({
      id: entry.id,
      kind: "Sumaste",
      when: formatReportTimestamp(entry.createdAt),
      reason: null,
      text: entry.details,
      photos: entry.photos ?? [],
    })),
  ];
}

/** Alto de los botones del composer y del campo con una sola línea: todo alineado. En
 * `style`, no con `h-11`/`w-11`: NativeWind en nativo usa 1rem = 14px, así que `h-11`
 * da 38,5px y los botones quedaban más chicos que el campo. */
const COMPOSER_CONTROL_HEIGHT = 44;
const COMPOSER_BUTTON_STYLE = { width: COMPOSER_CONTROL_HEIGHT, height: COMPOSER_CONTROL_HEIGHT };
const COMPOSER_LINE_HEIGHT = 20;
/** El texto crece hasta 5 líneas; más allá scrollea adentro y el historial sigue visible. */
const COMPOSER_INPUT_MAX_HEIGHT = COMPOSER_LINE_HEIGHT * 5;

const SECTION_LABEL = "font-sans-semibold text-caption uppercase tracking-[0.88px]";

/**
 * MOVO-256 (rediseño, mockup "Reportar usuario" 1A): el reporte propio en revisión
 * como un hilo. Arriba el estado, después lo original y cada cosa que se sumó con su
 * fecha, y "Tu seguridad" con bloquear como acción secundaria. El composer queda fijo
 * abajo, tipo chat: texto, fotos o ambos, sin editar nunca lo ya enviado (MOVO-175).
 */
export function PendingReportView({
  userId,
  report,
  reportedName,
  notice,
  isBlocked,
  blockPending,
  onBlock,
  onEntryAdded,
  testID = "pending-report",
}: PendingReportViewProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const addEntryMutation = useAddReportEntry(userId);
  const draftPhotos = useReportPhotos(userId);

  const firstName = reportedName.split(" ")[0] ?? reportedName;
  const hasContent = draft.trim().length > 0 || draftPhotos.uploadedKeys.length > 0;
  const canSend = hasContent && !draftPhotos.hasPending && !addEntryMutation.isPending;

  async function handleSend() {
    if (!canSend) return;
    setErrorMessage(null);
    const details = draft.trim();
    try {
      await addEntryMutation.mutateAsync({
        ...(details ? { details } : {}),
        ...(draftPhotos.uploadedKeys.length > 0 ? { photoKeys: draftPhotos.uploadedKeys } : {}),
      });
      setDraft("");
      draftPhotos.reset();
      Keyboard.dismiss();
      onEntryAdded();
    } catch (err) {
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos sumar la información. Probá de nuevo.", {
          RATE_LIMIT_EXCEEDED: "Hiciste demasiados reportes hoy. Probá de nuevo mañana.",
          REPORT_PHOTO_ALREADY_USED: "Una de las fotos ya está en tu reporte. Quitala y probá de nuevo.",
        }),
      );
    }
  }

  const timeline = toTimeline(report);

  return (
    <View className="flex-1" testID={testID}>
      <ScrollView
        testID={`${testID}-scroll`}
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Estado del reporte. Fondo oscuro fijo en los dos temas (mockup 1A); el borde
            solo se nota en dark, donde el card se funde con el fondo. */}
        <View
          testID={`${testID}-status`}
          className="gap-2.5 overflow-hidden rounded-md border border-border bg-ink-950 p-[18px]"
        >
          <GridPattern color="#FFFFFF" opacity={0.06} cellSize={24} fade="top-right" />
          <View className="flex-row items-center gap-2">
            {/* Anillo de 4px alrededor del punto (box-shadow con spread en el mockup):
                absoluto para no correr el texto. */}
            <View className="h-2 w-2">
              <View className="absolute -inset-1 rounded-full bg-lime-500/25" />
              <View className="h-2 w-2 rounded-full bg-lime-500" />
            </View>
            <Text className={`${SECTION_LABEL} text-lime-500`}>En revisión</Text>
          </View>
          <Text className="font-sans-semibold text-[22px] leading-[26px] tracking-[-0.44px] text-white">
            Recibimos tu reporte sobre {reportedName}.
          </Text>
          <Text className="font-sans text-[14px] leading-[20px] text-ink-300">
            Te avisamos cuando haya novedades. Si te acordás de algo más, sumalo abajo.
          </Text>
        </View>

        {notice ? (
          <View className="rounded-md bg-bg-mute px-3.5 py-3" testID={`${testID}-notice`}>
            <Text className="font-sans text-small text-fg-2">{notice}</Text>
          </View>
        ) : null}

        {/* Historial: lo original y cada entrada, del más viejo al más nuevo. */}
        <View testID={`${testID}-history`}>
          {timeline.map((item, index) => (
            <View key={item.id} className="flex-row gap-3" testID={`${testID}-item-${index}`}>
              <View className="w-4 items-center">
                <View className="mt-[5px] h-[9px] w-[9px] rounded-full bg-fg" />
                <View className="mt-1 w-px flex-1 bg-border" />
              </View>
              <View className="min-w-0 flex-1 gap-2 pb-5">
                <View className="flex-row items-baseline justify-between gap-2">
                  <Text className={`${SECTION_LABEL} text-fg-3`}>{item.kind}</Text>
                  <Text className="font-mono text-[12px] text-ink-400">{item.when}</Text>
                </View>
                {item.reason ? (
                  <View className="self-start rounded-full bg-bg-mute px-2.5 py-1">
                    <Text className="font-sans-medium text-small text-fg" testID={`${testID}-reason`}>
                      {item.reason}
                    </Text>
                  </View>
                ) : null}
                {item.text ? (
                  <Text className="font-sans text-body text-fg" testID={`${testID}-item-${index}-text`}>
                    {item.text}
                  </Text>
                ) : null}
                <ReportPhotoGrid photos={item.photos} testID={`${testID}-item-${index}-photos`} />
              </View>
            </View>
          ))}
        </View>

        <View className="mt-auto gap-2.5">
          <Text className={`${SECTION_LABEL} text-fg-3`}>Tu seguridad</Text>
          {isBlocked ? (
            <View
              testID={`${testID}-blocked`}
              className="flex-row items-center gap-3 rounded-md border border-border px-4 py-3.5"
            >
              <Ban size={20} color={colors.fg3} strokeWidth={2} />
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-body text-fg">Bloqueaste a {firstName}</Text>
                <Text className="font-sans text-small text-fg-3">
                  Podés desbloquearlo desde Configuración › Cuenta y seguridad.
                </Text>
              </View>
            </View>
          ) : (
            <Pressable
              testID={`${testID}-block`}
              onPress={onBlock}
              disabled={blockPending}
              accessibilityRole="button"
              className="flex-row items-center gap-3 rounded-md border border-border px-4 py-3.5 active:border-border-strong"
            >
              <Ban size={20} color="#E5484D" strokeWidth={2} />
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-body text-danger-500">Bloquear a {firstName}</Text>
                <Text className="font-sans text-small text-fg-3">No te va a volver a tocar en un envío.</Text>
              </View>
              {blockPending ? (
                <ActivityIndicator size="small" color={colors.fg3} />
              ) : (
                <ChevronRight size={18} color="#8A8A93" strokeWidth={2} />
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* Composer fijo abajo, tipo chat (mockup 1A). Botones redondos del mismo alto
          que el campo con una línea; el campo crece con el texto y los botones quedan
          anclados abajo, como en una app de mensajes. */}
      <View
        testID={`${testID}-composer`}
        className="gap-2 border-t border-border bg-bg px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        {errorMessage ? <ErrorBanner testID={`${testID}-error`} message={errorMessage} /> : null}
        <ReportDraftPhotoRow
          testID={`${testID}-draft-photos`}
          photos={draftPhotos.photos}
          max={draftPhotos.max}
          onRemove={draftPhotos.remove}
          onRetry={draftPhotos.retry}
        />
        <View className="flex-row items-end gap-2">
          <Pressable
            testID={`${testID}-add-photo`}
            onPress={draftPhotos.add}
            disabled={!draftPhotos.canAddMore}
            accessibilityRole="button"
            accessibilityLabel="Agregar foto"
            accessibilityState={{ disabled: !draftPhotos.canAddMore }}
            style={COMPOSER_BUTTON_STYLE}
            className={`items-center justify-center rounded-full bg-bg-mute active:bg-ink-150 ${
              draftPhotos.canAddMore ? "" : "opacity-40"
            }`}
          >
            <ImagePlus size={20} color={colors.fg1} strokeWidth={1.9} />
          </Pressable>
          {/* El borde y el alto viven en este contenedor (mínimo 44px, igual que los
              botones) y el TextInput va adentro sin padding: iOS le suma unos px propios
              al input multilínea, y así quedan absorbidos en vez de agrandar el campo.
              Tocar cualquier parte del contenedor enfoca el input. */}
          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessible={false}
            style={{ minHeight: COMPOSER_CONTROL_HEIGHT }}
            className={`min-w-0 flex-1 justify-center rounded-[22px] border bg-bg px-4 py-2 ${
              focused ? "border-fg" : "border-border-strong"
            }`}
          >
            <TextInput
              ref={inputRef}
              testID={`${testID}-entry-input`}
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setErrorMessage(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Sumá lo que no contaste antes…"
              placeholderTextColor="#8A8A93"
              multiline
              maxLength={500}
              textAlignVertical="top"
              // Crece solo con el contenido hasta el máximo; pasado el máximo scrollea
              // adentro. Padding en 0 en `style` para pisar el inset por defecto de iOS.
              style={{
                maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
                paddingTop: 0,
                paddingBottom: 0,
                paddingHorizontal: 0,
                lineHeight: COMPOSER_LINE_HEIGHT,
              }}
              className="font-sans text-[15px] text-fg"
            />
          </Pressable>
          <Pressable
            testID={`${testID}-add-button`}
            onPress={() => void handleSend()}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Agregar al reporte"
            accessibilityState={{ disabled: !canSend }}
            style={COMPOSER_BUTTON_STYLE}
            className={`items-center justify-center rounded-full ${canSend ? "bg-fg" : "bg-bg-mute"}`}
          >
            {addEntryMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.fg3} />
            ) : (
              <ArrowUp size={20} color={canSend ? colors.bg : "#B4B4BC"} strokeWidth={2} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
