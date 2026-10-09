import { ArrowRight, ChevronRight, Clock } from "lucide-react-native";
import { Text, View } from "react-native";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { packageTypeIcon } from "../send/category-grid";
import type { PackageType } from "../../src/store/shipment-wizard-store";
import {
  formatPickupDateLabel,
  formatPickupWindowLabel,
  formatPriceArs,
  shipmentStatusLabel,
  shortAddressLabel,
} from "../../src/lib/shipment-format";
import { getInitials } from "../../src/lib/profile-format";
import type { TripAcceptedPackage } from "../../src/api/trips-client";
import { PressableScale } from "./pressable-scale";

// Estado del envío visto desde el viaje: "Por retirar"/"A bordo" son los dos que el
// transportista vive en el día a día (mockup MOVO-263); el resto usa la etiqueta general.
function packageStatus(status: ShipmentStatus): { label: string; bg: string; fg: string } {
  if (status === ShipmentStatus.ASSIGNED) {
    return { label: "Por retirar", bg: "rgba(245,185,58,0.2)", fg: "#7A5200" };
  }
  if (status === ShipmentStatus.IN_TRANSIT) {
    return { label: "A bordo", bg: "#EEFCBF", fg: "#27272B" };
  }
  return { label: shipmentStatusLabel(status), bg: "#F1F1F3", fg: "#3A3A40" };
}

/**
 * Fila de un paquete aceptado en el detalle del viaje (MOVO-263 AC2): tipo, ruta corta,
 * ventana de retiro, emisor, estado del envío y precio acordado. Tocarla abre el detalle
 * del envío.
 */
export function TripPackageRow({
  pkg,
  onPress,
  testID,
}: {
  pkg: TripAcceptedPackage;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const Icon = packageTypeIcon(pkg.packageType as PackageType);
  const status = packageStatus(pkg.status);
  const date = formatPickupDateLabel(pkg.pickupDate);
  const window = formatPickupWindowLabel(pkg.pickupTimeWindowStart, pkg.pickupTimeWindowEnd);

  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      className="flex-row gap-3 rounded-[10px] border border-border bg-bg p-3"
    >
      <View className="h-10 w-10 items-center justify-center rounded-lg bg-bg-mute">
        <Icon size={20} color={colors.fg1} strokeWidth={1.75} />
      </View>
      <View className="min-w-0 flex-1 gap-[5px]">
        <View className="flex-row items-center gap-1.5">
          <Text className="shrink font-sans-medium text-[14px] text-fg" numberOfLines={1}>
            {shortAddressLabel(pkg.pickupAddress)}
          </Text>
          <ArrowRight size={13} color={colors.fg3} strokeWidth={1.75} />
          <Text className="shrink font-sans-medium text-[14px] text-fg" numberOfLines={1}>
            {shortAddressLabel(pkg.deliveryAddress)}
          </Text>
        </View>
        <View className="flex-row items-center gap-[5px]">
          <Clock size={12} color={colors.fg3} strokeWidth={1.75} />
          <Text className="font-sans text-[12px] text-fg-3" numberOfLines={1}>
            Retiro {[date, window].filter(Boolean).join(", ")}
          </Text>
        </View>
        <View className="mt-0.5 flex-row items-center gap-2">
          <View className="flex-row items-center gap-1.5">
            <View className="h-5 w-5 items-center justify-center rounded-full bg-fg">
              <Text className="font-sans-semibold text-[9px] text-bg">{getInitials(pkg.senderName)}</Text>
            </View>
            <Text className="font-sans text-[12px] text-fg-2" numberOfLines={1}>
              {pkg.senderName}
            </Text>
          </View>
          <View
            testID={testID ? `${testID}-status` : undefined}
            className="h-5 justify-center rounded-full px-2"
            style={{ backgroundColor: status.bg }}
          >
            <Text className="font-sans-semibold text-[11px]" style={{ color: status.fg }}>
              {status.label}
            </Text>
          </View>
        </View>
      </View>
      <View className="flex-row items-center gap-1">
        <Text className="font-sans-semibold text-[15px] tracking-[-0.15px] text-fg">
          {formatPriceArs(pkg.agreedPriceArs)}
        </Text>
        <ChevronRight size={18} color={colors.fg3} strokeWidth={1.75} />
      </View>
    </PressableScale>
  );
}
