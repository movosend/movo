import { ArrowRight, ChevronRight, Clock } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Text, View } from "react-native";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { packageTypeIcon } from "../send/category-grid";
import type { PackageType } from "../../src/store/shipment-wizard-store";
import {
  formatPickupDateLabel,
  formatPriceArs,
  shipmentStatusLabel,
  shortAddressLabel,
} from "../../src/lib/shipment-format";
import { formatTimeRange } from "../../src/lib/time-format";
import { AvatarImage } from "../ui/avatar-image";
import type { TripAcceptedPackage } from "../../src/api/trips-client";
import { PressableScale } from "./pressable-scale";

// Estado del envío visto desde el viaje: "Por retirar"/"A bordo" son los dos que el
// transportista vive en el día a día (mockup MOVO-263); el resto usa la etiqueta general.
function packageStatus(status: ShipmentStatus, dark: boolean): { label: string; bg: string; fg: string } {
  if (status === ShipmentStatus.ASSIGNED) {
    return { label: "Por retirar", bg: "rgba(245,185,58,0.2)", fg: dark ? "#F5B93A" : "#7A5200" };
  }
  if (status === ShipmentStatus.IN_TRANSIT) {
    return dark
      ? { label: "A bordo", bg: "rgba(210,245,80,0.18)", fg: "#E4F98F" }
      : { label: "A bordo", bg: "#EEFCBF", fg: "#27272B" };
  }
  return dark
    ? { label: shipmentStatusLabel(status), bg: "rgba(255,255,255,0.1)", fg: "#D4D4D8" }
    : { label: shipmentStatusLabel(status), bg: "#F1F1F3", fg: "#3A3A40" };
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
  const { colorScheme } = useColorScheme();
  const Icon = packageTypeIcon(pkg.packageType as PackageType);
  const status = packageStatus(pkg.status, colorScheme === "dark");
  const date = formatPickupDateLabel(pkg.pickupDate);
  const window = formatTimeRange(pkg.pickupTimeWindowStart, pkg.pickupTimeWindowEnd);

  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      className="gap-3.5 rounded-[12px] border border-border bg-bg p-4"
    >
      <View className="flex-row items-start gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-lg bg-bg-mute">
          <Icon size={22} color={colors.fg1} strokeWidth={1.75} />
        </View>
        <View className="min-w-0 flex-1 gap-1.5">
          <View className="flex-row items-center gap-1.5">
            <Text className="shrink font-sans-semibold text-[15px] text-fg" numberOfLines={1}>
              {shortAddressLabel(pkg.pickupAddress)}
            </Text>
            <ArrowRight size={14} color={colors.fg3} strokeWidth={1.75} />
            <Text className="shrink font-sans-semibold text-[15px] text-fg" numberOfLines={1}>
              {shortAddressLabel(pkg.deliveryAddress)}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Clock size={13} color={colors.fg3} strokeWidth={1.75} />
            <Text className="flex-1 font-sans text-[13px] text-fg-3" numberOfLines={1}>
              Retiro {[date, window].filter(Boolean).join(", ")}
            </Text>
          </View>
        </View>
        <ChevronRight size={18} color={colors.fg3} strokeWidth={1.75} style={{ marginTop: 2 }} />
      </View>
      <View className="h-px bg-border" />
      <View className="flex-row items-center gap-2.5">
        <AvatarImage
          testID={testID ? `${testID}-sender-avatar` : undefined}
          fullName={pkg.senderName}
          photoUrl={pkg.senderPhotoUrl}
          size={28}
        />
        <Text className="min-w-0 flex-1 font-sans-medium text-[13px] text-fg-2" numberOfLines={1}>
          {pkg.senderName}
        </Text>
        <View
          testID={testID ? `${testID}-status` : undefined}
          className="h-6 justify-center rounded-full px-2.5"
          style={{ backgroundColor: status.bg }}
        >
          <Text className="font-sans-semibold text-[12px]" style={{ color: status.fg }}>
            {status.label}
          </Text>
        </View>
        <Text className="font-sans-semibold text-[16px] tracking-[-0.16px] text-fg">
          {formatPriceArs(pkg.agreedPriceArs)}
        </Text>
      </View>
    </PressableScale>
  );
}
