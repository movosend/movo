import type { VehicleProfile } from "@movo/shared/dist/types/user-profile";
import { Truck } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface VehicleCardProps {
  vehicle: VehicleProfile | null | undefined;
  testID?: string;
}

/**
 * Ficha de vehículo del transportista (MOVO-172, todavía sin backend) — oculta si
 * `vehicle` es `null`/`undefined` (no cargó ficha, o no es transportista).
 * Mostrar la patente en público es intencional: transparencia de seguridad, quien
 * entrega su paquete puede verificar el vehículo antes de subirlo.
 */
export function VehicleCard({ vehicle, testID }: VehicleCardProps) {
  const colors = useThemeColors();

  if (!vehicle) return null;

  return (
    <View
      testID={testID}
      className="flex-row items-center gap-3 rounded-[16px] border border-border bg-bg px-4 py-3.5"
    >
      <View className="h-[42px] w-[42px] items-center justify-center rounded-xl bg-bg-mute">
        <Truck size={22} strokeWidth={1.75} color={colors.fg1} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-sans-semibold text-[14.5px] text-fg">
          {vehicle.brand} {vehicle.model}
        </Text>
        <Text className="font-sans text-[12.5px] text-fg-2">{vehicle.cargoCapacityLabel}</Text>
      </View>
      <Text className="font-mono text-[11px] uppercase tracking-wide text-fg-3">
        {vehicle.licensePlate}
      </Text>
    </View>
  );
}
