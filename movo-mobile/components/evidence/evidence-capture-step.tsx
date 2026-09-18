import { Camera, Check } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { AddPhotoTile } from "../send/photo-slot";
import { ErrorBanner } from "../ui/error-banner";
import { useEvidenceStatus } from "../../src/hooks/use-shipments";
import { useEvidencePhotos } from "../../src/hooks/use-evidence-photos";
import { PhotoThumbnail } from "./photo-thumbnail";

// 3 columnas, mismo criterio de layout que `photos-step.tsx` (MOVO-83) — el tamaño de
// celda se deriva del ancho real del grid, no de un porcentaje fijo (Yoga no resuelve
// bien el aspect ratio con una sola celda de `flex-wrap`).
const GRID_COLUMNS = 3;
const GRID_GAP = 10;

const STAGE_COPY = {
  pickup: { title: "Evidencia del retiro", subtitle: "estado del paquete al retirarlo" },
  delivery: { title: "Evidencia de la entrega", subtitle: "estado del paquete al entregarlo" },
} as const;

export interface EvidenceCaptureStepProps {
  shipmentId: string;
  stage: "pickup" | "delivery";
  /** Único canal hacia el wizard contenedor (MOVO-198/199): se llama cuando cambia si
   * la evidencia mínima está satisfecha. Este componente no es dueño de la navegación
   * ni del botón "Continuar" — el wizard puede además consultar `useEvidenceStatus`
   * por su cuenta (misma query key, sin requests duplicadas) para gatear su propio
   * paso siguiente, tal como piden AC3 de MOVO-198 y MOVO-199 ("no asume, consulta"). */
  onValidityChange?: (isValid: boolean) => void;
}

/**
 * Step reusable de captura de evidencia fotográfica (MOVO-197) — lo montan los dos
 * wizards del transportista (retiro y entrega, MOVO-198/199) pasándole el `stage`
 * correspondiente. Mínimo/máximo de fotos y si ya está satisfecho salen siempre de
 * `GET /shipments/:id/evidence-status` (MOVO-196), nunca hardcodeados acá.
 */
export function EvidenceCaptureStep({ shipmentId, stage, onValidityChange }: EvidenceCaptureStepProps) {
  const { data: evidenceStatus, isLoading: isStatusLoading, isError: isStatusError, refetch } =
    useEvidenceStatus(shipmentId);
  const { photos, issue, clearIssue, capture, retry, remove, confirmedThisSession } = useEvidencePhotos(
    shipmentId,
    stage,
  );
  const [slotSize, setSlotSize] = useState(0);

  // `evidence-status` recién refleja una confirmación reciente después de su refetch
  // (invalidado por `useEvidencePhotos` al confirmar) — mientras esa respuesta viaja,
  // usar el máximo entre lo que ya confirmó esta sesión y lo último que devolvió el
  // servidor evita un parpadeo donde el conteo "baja" un instante.
  const effectiveCount = Math.max(evidenceStatus?.photoCount ?? 0, confirmedThisSession);
  // Fotos confirmadas en una sesión anterior (no capturadas en este montaje): no hay
  // forma de traer su preview acá — `GET /shipments/:id/photos` no incluye al
  // transportista en su autorización (MOVO-196) — así que se muestran como celdas
  // "ya confirmada" sin imagen, solo para que el conteo del grid cuadre con el real.
  const unpreviewedConfirmedCount = Math.max(0, effectiveCount - confirmedThisSession);

  const minRequired = evidenceStatus?.minRequired;
  const maxAllowed = evidenceStatus?.maxAllowed;
  const isValid = !isStatusLoading && !isStatusError && minRequired !== undefined && effectiveCount >= minRequired;

  const onValidityChangeRef = useRef(onValidityChange);
  onValidityChangeRef.current = onValidityChange;
  useEffect(() => {
    onValidityChangeRef.current?.(isValid);
  }, [isValid]);

  useEffect(() => {
    if (!issue) return;
    if (issue.type === "denied") {
      showCameraPermissionAlert(issue.canAskAgain, capture);
    }
    // "unavailable" se muestra como banner persistente más abajo, no como alert —
    // no hay ninguna acción que ofrecer más que informar (AC3: sin fallback a galería).
    if (issue.type !== "unavailable") {
      clearIssue();
    }
  }, [issue, capture, clearIssue]);

  const occupiedSlots = unpreviewedConfirmedCount + photos.length;
  const canAddMore = maxAllowed !== undefined && occupiedSlots < maxAllowed && issue?.type !== "unavailable";

  const copy = STAGE_COPY[stage];

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <Camera size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">{copy.title}</Text>
        <Text className="font-sans text-body text-fg-2">
          {minRequired !== undefined
            ? `Sacá al menos ${minRequired} foto${minRequired === 1 ? "" : "s"} del ${copy.subtitle}.`
            : `Sacá fotos del ${copy.subtitle}.`}
        </Text>
      </View>

      {isStatusError ? (
        <ErrorBanner
          testID="evidence-step-status-error"
          message="No pudimos cargar el estado de la evidencia. Tirá para reintentar."
        />
      ) : null}

      {issue?.type === "unavailable" ? (
        <ErrorBanner
          testID="evidence-step-camera-unavailable"
          message="Este dispositivo no tiene cámara disponible. No podés cargar evidencia sin sacar la foto en el momento."
        />
      ) : null}

      <View
        testID="evidence-step-grid"
        className="flex-row flex-wrap gap-2.5"
        onLayout={(e) => setSlotSize((e.nativeEvent.layout.width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS)}
      >
        {Array.from({ length: unpreviewedConfirmedCount }).map((_, index) => (
          <ConfirmedPlaceholderTile key={`confirmed-${index}`} size={slotSize} testID={`evidence-step-confirmed-${index}`} />
        ))}
        {photos.map((photo, index) => (
          <PhotoThumbnail
            key={photo.id}
            testID={`evidence-step-photo-${index}`}
            photo={photo}
            size={slotSize}
            onRetry={() => retry(photo.id)}
            onRemove={() => remove(photo.id)}
          />
        ))}
        {canAddMore ? (
          <AddPhotoTile key="add-tile" testID="evidence-step-add" size={slotSize} onPress={() => void capture()} />
        ) : null}
      </View>

      {isStatusError ? (
        <Pressable
          testID="evidence-step-status-retry"
          onPress={() => void refetch()}
          className="self-start rounded-lg bg-bg-mute px-3 py-1.5"
        >
          <Text className="font-sans-medium text-small text-fg">Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ConfirmedPlaceholderTile({ size, testID }: { size: number; testID?: string }) {
  return (
    <View
      testID={testID}
      style={{ width: size, height: size }}
      className="items-center justify-center gap-1 rounded-[10px] border border-success-300 bg-success-100"
    >
      <Check size={18} color="#16754A" strokeWidth={2.4} />
      <Text className="font-sans text-[10px] text-fg-3">Confirmada</Text>
    </View>
  );
}

// Mismo patrón que `photos-step.tsx`/`photo-picker.tsx`: un permiso denegado no debería
// quedar en silencio. Acá se distingue, a diferencia de esos dos, entre "se puede
// volver a pedir" (reintentar en el momento) y "denegado para siempre" (ajustes del
// sistema) — AC2 de MOVO-197 lo pide explícitamente.
function showCameraPermissionAlert(canAskAgain: boolean, onRetry: () => void) {
  if (canAskAgain) {
    Alert.alert(
      "Permiso necesario",
      "Movo necesita acceso a tu cámara para sacar la foto de evidencia.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Reintentar", onPress: () => void onRetry() },
      ],
    );
    return;
  }
  Alert.alert(
    "Permiso necesario",
    "Movo necesita acceso a tu cámara para sacar la foto de evidencia. Habilitalo desde los ajustes de tu dispositivo.",
    [
      { text: "Cancelar", style: "cancel" },
      { text: "Abrir Ajustes", onPress: () => void Linking.openSettings() },
    ],
  );
}
