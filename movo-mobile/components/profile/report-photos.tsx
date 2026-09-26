import type { UserReportPhoto } from "@movo/shared/dist/types/user";
import { RotateCw, X } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import type { ReportDraftPhoto } from "../../src/hooks/use-report-photos";
import { PhotoViewerModal } from "../shipments/photo-viewer-modal";

export const DRAFT_THUMB_SIZE = 56;
const GRID_COLUMNS = 4;
const GRID_GAP = 6;

export interface ReportDraftPhotoRowProps {
  photos: ReportDraftPhoto[];
  max: number;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  /** Botón para sumar otra foto al final de la fila (formulario de reporte nuevo).
   * Con él, la fila se muestra aunque todavía no haya fotos. */
  addTile?: ReactNode;
  testID?: string;
}

/**
 * MOVO-256: fotos elegidas para el próximo envío, todavía sin mandar (mockup 1A:
 * miniaturas de 56px con la cruz para quitarlas y el contador "n/4"). Cada una muestra
 * su propio estado: subiendo, o con error y reintento al tocarla.
 */
export function ReportDraftPhotoRow({
  photos,
  max,
  onRemove,
  onRetry,
  addTile,
  testID = "report-draft-photos",
}: ReportDraftPhotoRowProps) {
  if (photos.length === 0 && !addTile) return null;
  const hasError = photos.some((p) => p.status === "error");

  return (
    <View testID={testID} className="gap-1.5">
      {/* pt/pr dejan lugar a la cruz, que sobresale 6px de la miniatura. */}
      <View className="flex-row items-center gap-1.5 pr-1.5 pt-1.5">
        {photos.map((photo, index) => (
          <View key={photo.id} style={{ width: DRAFT_THUMB_SIZE, height: DRAFT_THUMB_SIZE }}>
            <Pressable
              testID={`${testID}-${index}`}
              onPress={photo.status === "error" ? () => onRetry(photo.id) : undefined}
              disabled={photo.status !== "error"}
              accessibilityRole="image"
              accessibilityLabel={
                photo.status === "error"
                  ? "No se pudo subir la foto. Tocá para reintentar."
                  : photo.status === "uploading"
                    ? "Subiendo foto"
                    : "Foto adjunta"
              }
              className={`h-full w-full overflow-hidden rounded-[10px] border ${
                photo.status === "error" ? "border-danger-500" : "border-border"
              }`}
            >
              <Image source={{ uri: photo.localUri }} className="h-full w-full" resizeMode="cover" />
              {photo.status === "uploading" ? (
                <View
                  testID={`${testID}-${index}-uploading`}
                  className="absolute inset-0 items-center justify-center bg-black/40"
                >
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              ) : null}
              {photo.status === "error" ? (
                <View
                  testID={`${testID}-${index}-error`}
                  className="absolute inset-0 items-center justify-center bg-danger-500/70"
                >
                  <RotateCw size={18} color="#FFFFFF" strokeWidth={2.2} />
                </View>
              ) : null}
            </Pressable>
            <Pressable
              testID={`${testID}-${index}-remove`}
              onPress={() => onRemove(photo.id)}
              accessibilityRole="button"
              accessibilityLabel="Quitar foto"
              hitSlop={8}
              className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-ink-950"
            >
              <X size={12} color="#FFFFFF" strokeWidth={2.5} />
            </Pressable>
          </View>
        ))}
        {addTile}
        <Text className="ml-auto font-mono text-[12px] text-ink-400" testID={`${testID}-count`}>
          {photos.length}/{max}
        </Text>
      </View>
      {hasError ? (
        <Text className="font-sans text-small text-danger-600" testID={`${testID}-error-hint`}>
          {photos.find((p) => p.status === "error")?.errorMessage ?? "No pudimos subir una foto."} Tocala para
          reintentar o quitala.
        </Text>
      ) : null}
    </View>
  );
}

export interface ReportPhotoGridProps {
  photos: UserReportPhoto[];
  testID?: string;
}

/**
 * MOVO-256: fotos ya enviadas de un reporte o de una entrada, en grilla de 4 columnas
 * (mockup 1A). Tocar una abre el visor a pantalla completa con zoom. Las URLs son
 * presigned GET de TTL corto: se usan tal cual llegan del último `GET`.
 */
export function ReportPhotoGrid({ photos, testID = "report-photo-grid" }: ReportPhotoGridProps) {
  const [cellSize, setCellSize] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  if (photos.length === 0) return null;

  return (
    <>
      <View
        testID={testID}
        className="flex-row flex-wrap"
        style={{ gap: GRID_GAP }}
        onLayout={(e) => setCellSize((e.nativeEvent.layout.width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS)}
      >
        {photos.map((photo, index) => (
          <Pressable
            key={photo.id}
            testID={`${testID}-${index}`}
            onPress={() => setViewerIndex(index)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Ver foto ${index + 1} de ${photos.length}`}
            style={{ width: cellSize, height: cellSize }}
            className="overflow-hidden rounded-[10px] border border-border bg-bg-mute active:opacity-80"
          >
            {cellSize > 0 ? <Image source={{ uri: photo.url }} className="h-full w-full" resizeMode="cover" /> : null}
          </Pressable>
        ))}
      </View>
      <PhotoViewerModal
        testID={`${testID}-viewer`}
        photos={photos}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </>
  );
}
