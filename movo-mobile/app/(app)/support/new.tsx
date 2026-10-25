import { SUPPORT_MESSAGE_MAX_LENGTH } from "@movo/shared/dist/types/admin-support";
import type { SupportTopic } from "@movo/shared/dist/types/admin-support";
import type { SupportShipmentOption } from "@movo/shared/dist/types/support";
import * as Crypto from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ImagePlus, X } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReportDraftPhotoRow, DRAFT_THUMB_SIZE } from "../../../components/profile/report-photos";
import { ShipmentSelectField } from "../../../components/support/shipment-select-field";
import { SelectField } from "../../../components/ui/select-field";
import { TextField } from "../../../components/ui/text-field";
import { useSupportShipments } from "../../../src/hooks/use-support";
import { useSupportPhotos } from "../../../src/hooks/use-support-photos";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { activeShipmentDisplayCode } from "../../../src/lib/active-shipment-format";
import { SUPPORT_TOPIC_OPTIONS, supportTopicLabel } from "../../../src/lib/support-format";
import { useSupportDraftStore } from "../../../src/store/support-draft-store";

/** Desde este largo se muestra el contador ("1.800 de 2.000"). */
const COUNTER_THRESHOLD = 1800;

// Constante de módulo: un objeto nuevo por render haría que `Stack.Screen` llame a `setOptions` en cada render.
const SCREEN_OPTIONS = { presentation: "modal" } as const;
const TOPIC_LABELS = SUPPORT_TOPIC_OPTIONS.map((option) => option.label);

const formatCount = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * MOVO-324: "Nueva consulta" (modal). Tema sin valor por defecto, envío vinculado opcional ("No es sobre un envío"
 * por defecto), texto y hasta 4 fotos. Abierta desde el detalle de un envío (`?shipmentId=`) llega con tema Envío y ese
 * envío ya vinculado. "Enviar consulta" pasa directo a la conversación (`support/pending`), que hace el POST.
 */
export default function NewSupportRequestScreen() {
  const colors = useThemeColors();
  const { shipmentId: shipmentIdParam } = useLocalSearchParams<{ shipmentId?: string }>();
  const [topic, setTopic] = useState<SupportTopic | null>(shipmentIdParam ? "shipment" : null);
  const [shipmentId, setShipmentId] = useState<string | null>(shipmentIdParam ?? null);
  const [text, setText] = useState("");
  const photos = useSupportPhotos();
  const shipmentsQuery = useSupportShipments(topic === "shipment");
  const setDraft = useSupportDraftStore((s) => s.setDraft);
  // Un solo id por formulario: si el POST falla, el reintento de la conversación usa el mismo y no se duplica.
  const clientMessageIdRef = useRef(Crypto.randomUUID());

  const options = useMemo(() => shipmentsQuery.data?.pages.flatMap((page) => page.items) ?? [], [shipmentsQuery.data]);
  const selected: SupportShipmentOption | null = useMemo(() => {
    if (!shipmentId) return null;
    return (
      options.find((option) => option.id === shipmentId) ?? {
        // Llegó desde el detalle y todavía no cargó la lista (o el envío no está en la primera página).
        id: shipmentId,
        code: activeShipmentDisplayCode(shipmentId).replace("#", ""),
        status: "",
        route: "",
        role: "sender",
        createdAt: "",
      }
    );
  }, [options, shipmentId]);

  const trimmed = text.trim();
  const canSubmit = !!topic && trimmed.length > 0 && trimmed.length <= SUPPORT_MESSAGE_MAX_LENGTH && !photos.hasPending;

  const onTopicChange = (label: string) => {
    const next = SUPPORT_TOPIC_OPTIONS.find((option) => option.label === label)?.value ?? null;
    setTopic(next);
    // El envío vinculado solo existe para el tema Envío.
    if (next !== "shipment") setShipmentId(null);
  };

  const submit = () => {
    if (!canSubmit || !topic) return;
    setDraft({
      topic,
      body: trimmed,
      clientMessageId: clientMessageIdRef.current,
      shipment: selected ? { id: selected.id, code: selected.code } : null,
      attachments: photos.photos.flatMap((p) => (p.status === "uploaded" && p.attachmentId ? [{ attachmentId: p.attachmentId, localUri: p.localUri }] : [])),
      createdAt: new Date().toISOString(),
    });
    router.replace("/support/pending" as never);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <View className="flex-row items-center justify-between px-4 pb-2 pt-2">
        <Text className="font-sans-semibold text-h3 text-fg">Nueva consulta</Text>
        <Pressable
          testID="support-new-close"
          accessibilityLabel="Cerrar"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/support/conversations" as never))}
          className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
        >
          <X size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
          <View>
            <SelectField
              testID="support-topic"
              label="¿Sobre qué es?"
              placeholder="Elegí un tema"
              value={topic ? supportTopicLabel(topic) : ""}
              options={TOPIC_LABELS}
              onChange={onTopicChange}
              containerClassName="gap-1.5"
            />
          </View>

          {topic === "shipment" ? (
            <ShipmentSelectField
              label="Envío vinculado (opcional)"
              selected={selected}
              options={options}
              isLoading={shipmentsQuery.isLoading}
              isError={shipmentsQuery.isError}
              onRetry={() => void shipmentsQuery.refetch()}
              hasMore={!!shipmentsQuery.hasNextPage}
              onLoadMore={() => void shipmentsQuery.fetchNextPage()}
              onChange={(option) => setShipmentId(option?.id ?? null)}
            />
          ) : null}

          <View>
            <TextField
              testID="support-text"
              label="Contanos qué pasó"
              placeholder="Escribí tu consulta…"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
              containerClassName="gap-1.5"
            />
            {text.length >= COUNTER_THRESHOLD ? (
              <Text testID="support-text-counter" className="mt-1 text-right font-mono text-[10.5px] text-fg-3">
                {formatCount(text.length)} de {formatCount(SUPPORT_MESSAGE_MAX_LENGTH)}
              </Text>
            ) : null}
          </View>

          <View className="gap-2" testID="support-photos">
            <Text className="font-sans-semibold text-caption uppercase text-fg-3">Fotos (opcional)</Text>
            <ReportDraftPhotoRow
              testID="support-draft-photos"
              photos={photos.photos}
              max={photos.max}
              onRemove={photos.remove}
              onRetry={photos.retry}
              addTile={
                photos.canAddMore ? (
                  <Pressable
                    testID="support-add-photo"
                    onPress={photos.add}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar foto"
                    style={{ width: DRAFT_THUMB_SIZE, height: DRAFT_THUMB_SIZE }}
                    className="items-center justify-center rounded-[10px] bg-bg-mute"
                  >
                    <ImagePlus size={20} color={colors.fg1} strokeWidth={1.9} />
                  </Pressable>
                ) : null
              }
            />
            <Text className="font-sans text-small text-fg-3">
              Capturas, el paquete dañado. Solo las ve el equipo de Movo: evitá mostrar datos que no hagan falta.
            </Text>
          </View>
        </ScrollView>

        <View className="px-4 pb-3 pt-2">
          <Pressable
            testID="support-submit"
            onPress={submit}
            disabled={!canSubmit}
            accessibilityState={{ disabled: !canSubmit }}
            className={`w-full flex-row items-center justify-center rounded-lg bg-fg py-3.5 ${canSubmit ? "" : "opacity-40"}`}
          >
            <Text className="font-sans-semibold text-body text-bg">Enviar consulta</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
