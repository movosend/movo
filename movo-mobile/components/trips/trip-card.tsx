import { ArrowRight, Pencil, Trash2, Truck } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { shortAddressLabel } from "../../src/lib/shipment-format";
import { formatDepartureLabel, tripStatusLabel, tripStatusTone } from "../../src/lib/trip-format";
import type { TripWithAcceptedPackages } from "../../src/api/trips-client";

const TONE_BADGE_CLASS: Record<"success" | "warning" | "danger" | "info" | "neutral", string> = {
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
  info: "bg-info-100 text-info-700",
  neutral: "bg-bg-mute text-fg-2",
};

interface TripCardProps {
  trip: TripWithAcceptedPackages;
  onEdit: () => void;
  onDelete: () => void;
  testID?: string;
}

/**
 * Fila del listado "Mis viajes" (MOVO-162, AC2). Distinción visual de AC2/AC4: si
 * `hasAcceptedPackages`, no se exponen los íconos de editar/eliminar — se reemplazan
 * por un badge + texto explicativo, mismo criterio de "no ofrecer una acción que el
 * backend va a rechazar con 409" que ya usa `SenderActionsBar`/`ReceiverActionsBar`
 * (MOVO-29/MOVO-131) para sus propios gates de estado.
 */
export function TripCard({ trip, onEdit, onDelete, testID }: TripCardProps) {
  const colors = useThemeColors();
  const tone = tripStatusTone(trip.status);
  const [badgeBg, badgeText] = TONE_BADGE_CLASS[tone].split(" ");

  return (
    <View
      testID={testID}
      className="gap-3 rounded-[14px] border border-border-strong bg-bg p-4"
    >
      <View className="flex-row items-center justify-between">
        <View className={`rounded-full px-3 py-1 ${badgeBg}`}>
          <Text className={`font-sans-medium text-[11px] ${badgeText}`}>
            {tripStatusLabel(trip.status)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Truck size={14} color={colors.fg3} strokeWidth={1.8} />
          <Text className="font-sans text-[12px] text-fg-3">{trip.vehicleType}</Text>
        </View>
      </View>

      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-sans-medium text-[14px] text-fg" numberOfLines={1}>
          {shortAddressLabel(trip.originAddress)}
        </Text>
        <ArrowRight size={14} color={colors.fg3} strokeWidth={1.8} />
        <Text className="flex-1 text-right font-sans-medium text-[14px] text-fg" numberOfLines={1}>
          {shortAddressLabel(trip.destinationAddress)}
        </Text>
      </View>

      <Text className="font-sans text-[12px] text-fg-3">
        Salida: {formatDepartureLabel(trip.departureAt)}
      </Text>

      {trip.hasAcceptedPackages ? (
        <View className="gap-1.5 rounded-[10px] bg-bg-mute px-3.5 py-3">
          <Text
            testID={testID ? `${testID}-accepted-badge` : undefined}
            className="font-sans-medium text-[12px] text-fg"
          >
            Paquetes aceptados
          </Text>
          <Text className="font-sans text-[11px] text-fg-3">
            Este viaje tiene paquetes aceptados y no se puede modificar ni cancelar
            directamente.
          </Text>
        </View>
      ) : (
        <View className="flex-row justify-end gap-2 border-t border-border pt-3">
          <Pressable
            testID={testID ? `${testID}-edit` : undefined}
            onPress={onEdit}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
          >
            <Pencil size={15} color={colors.fg2} strokeWidth={1.8} />
          </Pressable>
          <Pressable
            testID={testID ? `${testID}-delete` : undefined}
            onPress={onDelete}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
          >
            <Trash2 size={15} color={colors.fg2} strokeWidth={1.8} />
          </Pressable>
        </View>
      )}
    </View>
  );
}
