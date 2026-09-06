import { ArrowRight, Clock, Pencil, Trash2, Truck } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { shortAddressLabel } from "../../src/lib/shipment-format";
import { formatDepartureLabel, tripStatusLabel, tripStatusTone } from "../../src/lib/trip-format";
import { TripStatus, type TripWithAcceptedPackages } from "../../src/api/trips-client";

const TONE_BADGE_CLASS: Record<"success" | "warning" | "danger" | "lime" | "neutral", string> = {
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
  // Acento de marca — feedback de UI: el estado "Activo" usa el lima característico
  // de Movo en vez del azul semántico genérico ("info").
  lime: "bg-lime-200 text-ink-950",
  neutral: "bg-bg-mute text-fg-2",
};

interface TripCardProps {
  trip: TripWithAcceptedPackages;
  onEdit: () => void;
  onDelete: () => void;
  onPress?: () => void;
  testID?: string;
}

/**
 * Fila del listado "Mis viajes" (MOVO-162, AC2). Distinción visual de AC2/AC4: si
 * `hasAcceptedPackages`, no se exponen los íconos de editar/eliminar — se reemplazan
 * por un badge + texto explicativo, mismo criterio de "no ofrecer una acción que el
 * backend va a rechazar con 409" que ya usa `SenderActionsBar`/`ReceiverActionsBar`
 * (MOVO-29/MOVO-131) para sus propios gates de estado. Mismo criterio para un viaje
 * `cancelled`/`completed` sin paquetes aceptados (hallazgo de review, PR #120): tampoco
 * tiene sentido ofrecer editar/eliminar un viaje que ya no está `active` — el backend
 * lo rechazaría igual (`update`/`delete` no filtran por status, pero no hay ninguna
 * transición de vuelta a `active` que la edición pudiera tener sentido de completar).
 *
 * `onPress` (MOVO-163) abre el feed de paquetes compatibles con este viaje — toda la
 * card es pressable, con editar/eliminar como `Pressable`s anidados (RN resuelve el
 * touch al más específico, sin bubbling tipo DOM) para que tocar esos íconos no
 * dispare también la navegación, mismo patrón que `ContactRow` (MOVO-139).
 */
export function TripCard({ trip, onEdit, onDelete, onPress, testID }: TripCardProps) {
  const colors = useThemeColors();
  const tone = tripStatusTone(trip.status);
  const [badgeBg, badgeText] = TONE_BADGE_CLASS[tone].split(" ");

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
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
      ) : null}

      <View className="flex-row items-center justify-between border-t border-border pt-3">
        <View className="flex-row items-center gap-1.5">
          <Clock size={14} color={colors.fg1} strokeWidth={1.8} />
          <Text className="font-sans-medium text-[13px] text-fg">
            Salida: {formatDepartureLabel(trip.departureAt)}
          </Text>
        </View>
        {!trip.hasAcceptedPackages && trip.status === TripStatus.ACTIVE ? (
          <View className="flex-row items-center gap-2.5">
            <Pressable
              testID={testID ? `${testID}-edit` : undefined}
              onPress={onEdit}
              hitSlop={8}
              accessibilityLabel="Editar viaje"
              className="rounded-full border border-border-strong bg-bg p-2"
            >
              <Pencil size={14} color={colors.fg1} strokeWidth={1.8} />
            </Pressable>
            <Pressable
              testID={testID ? `${testID}-delete` : undefined}
              onPress={onDelete}
              hitSlop={8}
              accessibilityLabel="Eliminar viaje"
              className="rounded-full bg-fg p-2"
            >
              <Trash2 size={14} color={colors.bg} strokeWidth={1.8} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
