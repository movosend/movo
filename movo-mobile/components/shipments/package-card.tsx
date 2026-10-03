import { Package } from "lucide-react-native";
import { Text, View } from "react-native";
import { packageTypeLabel } from "../send/category-grid";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface PackageCardProps {
  shipment: Pick<
    ShipmentSummary,
    "id" | "packageType" | "weightKg" | "lengthCm" | "widthCm" | "heightCm" | "description"
  >;
  testID?: string;
}

/** AC4 de MOVO-127: tipo/peso/dimensiones/descripción. Las fotos viven en
 * `EvidencePhotosSection`, agrupadas por stage (MOVO-194). */
export function PackageCard({ shipment, testID }: PackageCardProps) {
  const colors = useThemeColors();

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
    </View>
  );
}
