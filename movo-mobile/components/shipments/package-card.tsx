import { Camera, Package } from "lucide-react-native";
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { packageTypeLabel } from "../send/category-grid";
import { PhotoViewerModal } from "./photo-viewer-modal";
import { SkeletonBlock } from "../ui/skeleton-block";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useShipmentPhotos } from "../../src/hooks/use-shipments";

export interface PackageCardProps {
  shipment: Pick<
    ShipmentSummary,
    "id" | "packageType" | "weightKg" | "lengthCm" | "widthCm" | "heightCm" | "description"
  >;
  testID?: string;
}

const THUMB_SIZE = 56;

/** AC4 de MOVO-127: tipo/peso/dimensiones/descripción + tira de fotos de evidencia
 * (`GET /shipments/:id/photos`, MOVO-81). El fetch de fotos falla o carga
 * independiente del resto de la card — nunca bloquea mostrar los datos del paquete,
 * que ya vienen resueltos en `shipment`. Tocar una miniatura abre `PhotoViewerModal`
 * a pantalla completa en esa foto (feedback post-QA: antes solo había un conteo en
 * texto, sin forma de ver las fotos). */
export function PackageCard({ shipment, testID }: PackageCardProps) {
  const colors = useThemeColors();
  const { data: photos, isLoading: isLoadingPhotos } = useShipmentPhotos(shipment.id);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  return (
    <View testID={testID} className="overflow-hidden rounded-[14px] border border-border bg-bg">
      <View className="flex-row items-center gap-3 px-4 py-3.5">
        <View className="h-11 w-11 items-center justify-center rounded-[8px] bg-bg-mute">
          <Package size={22} color={colors.fg2} strokeWidth={1.8} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[14px] text-fg">{packageTypeLabel(shipment.packageType)}</Text>
          <Text className="mt-0.5 font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
            {shipment.weightKg} kg · {shipment.lengthCm} × {shipment.widthCm} × {shipment.heightCm} cm
          </Text>
          {shipment.description ? (
            <Text className="mt-1 font-sans text-small text-fg-2">{shipment.description}</Text>
          ) : null}
        </View>
      </View>

      <View className="gap-2 border-t border-border px-4 py-3">
        {isLoadingPhotos ? (
          <View className="flex-row gap-2">
            <SkeletonBlock style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 }} />
            <SkeletonBlock style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 }} />
          </View>
        ) : !photos || photos.length === 0 ? (
          <View className="flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-[6px] bg-bg-mute">
              <Camera size={16} color={colors.fg3} strokeWidth={1.8} />
            </View>
            <Text className="font-sans text-small text-fg-2">Sin fotos adjuntas</Text>
          </View>
        ) : (
          <>
            <Text className="font-sans text-small text-fg-2">
              {photos.length === 1 ? "1 foto de evidencia" : `${photos.length} fotos de evidencia`}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
              {photos.map((photo, index) => (
                <Pressable
                  key={photo.id}
                  testID={testID ? `${testID}-photo-${index}` : undefined}
                  onPress={() => setViewerIndex(index)}
                >
                  <Image
                    source={{ uri: photo.url }}
                    style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 }}
                    resizeMode="cover"
                  />
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}
      </View>

      {photos && photos.length > 0 ? (
        <PhotoViewerModal
          testID={testID ? `${testID}-viewer` : undefined}
          photos={photos}
          initialIndex={viewerIndex ?? 0}
          visible={viewerIndex !== null}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}
