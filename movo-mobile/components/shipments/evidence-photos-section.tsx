import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { PhotoViewerModal } from "./photo-viewer-modal";
import { RemoteImage } from "../ui/remote-image";
import type { ShipmentPhoto, ShipmentPhotoStage } from "../../src/api/shipments-client";
import { useShipmentPhotos } from "../../src/hooks/use-shipments";

const STAGE_ORDER: readonly ShipmentPhotoStage[] = ["creation", "pickup", "delivery"];

const STAGE_LABEL: Record<ShipmentPhotoStage, string> = {
  creation: "Al publicar",
  pickup: "Retiro",
  delivery: "Entrega",
};

const THUMB_SIZE = 64;

export interface EvidencePhotosSectionProps {
  shipmentId: string;
  testID?: string;
}

/** Fotos de evidencia del envío agrupadas por stage (MOVO-194 AC7), visibles para
 * emisor, receptor y transportista. Un stage sin fotos no se muestra, y sin ninguna
 * foto (o mientras cargan / si falla el fetch) la sección entera no se renderiza. */
export function EvidencePhotosSection({ shipmentId, testID }: EvidencePhotosSectionProps) {
  const { data: photos } = useShipmentPhotos(shipmentId);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const groups = useMemo(
    () =>
      STAGE_ORDER.map((stage) => ({
        stage,
        photos: (photos ?? []).filter((photo) => photo.stage === stage),
      })).filter((group) => group.photos.length > 0),
    [photos],
  );
  // El visor recorre todas las fotos en el mismo orden que la sección.
  const orderedPhotos = useMemo<ShipmentPhoto[]>(() => groups.flatMap((group) => group.photos), [groups]);

  if (orderedPhotos.length === 0) return null;

  let offset = 0;

  return (
    <View testID={testID}>
      <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">Evidencia</Text>
      <View className="gap-3.5 rounded-[14px] border border-border bg-bg px-4 py-3.5">
        {groups.map((group) => {
          const groupOffset = offset;
          offset += group.photos.length;
          return (
            <View key={group.stage} testID={testID ? `${testID}-${group.stage}` : undefined} className="gap-2">
              <Text className="font-sans-medium text-small text-fg-2">
                {STAGE_LABEL[group.stage]} · {group.photos.length}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {group.photos.map((photo, index) => (
                  <Pressable
                    key={photo.id}
                    testID={testID ? `${testID}-${group.stage}-photo-${index}` : undefined}
                    onPress={() => setViewerIndex(groupOffset + index)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Ver foto ${index + 1} de ${STAGE_LABEL[group.stage].toLowerCase()}`}
                  >
                    <RemoteImage
                      uri={photo.url}
                      style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 }}
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </View>

      <PhotoViewerModal
        testID={testID ? `${testID}-viewer` : undefined}
        photos={orderedPhotos}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </View>
  );
}
