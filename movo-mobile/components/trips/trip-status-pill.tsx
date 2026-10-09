import { Check, Timer, X } from "lucide-react-native";
import { Text, View } from "react-native";
import { tripStatusLabel } from "../../src/lib/trip-format";
import { TripStatus } from "../../src/api/trips-client";
import { PulseDot } from "./pulse-dot";

// [fondo, texto, ícono] de los estados de historial, tal cual el mockup de "Mis viajes".
// Colores con alfa/pastel propios: se ven bien sobre fondo claro y oscuro.
const HISTORY_PILL: Partial<Record<TripStatus, { bg: string; fg: string; Icon: typeof Check }>> = {
  [TripStatus.COMPLETED]: { bg: "rgba(43,182,115,0.14)", fg: "#1B7A4C", Icon: Check },
  [TripStatus.EXPIRED]: { bg: "#E6E6EA", fg: "#5A5A62", Icon: Timer },
  [TripStatus.CANCELLED]: { bg: "rgba(229,72,77,0.1)", fg: "#B42A2F", Icon: X },
};

/**
 * Pill de estado de un viaje (MOVO-262/263) y ÚNICO lugar donde se definen sus colores:
 * Declarado (lima), En curso (negro con punto que late) y, para los estados de historial,
 * fondo tintado con ícono. `compact` baja el alto a 22px (cards de historial).
 */
export function TripStatusPill({
  status,
  compact = false,
  testID,
}: {
  status: TripStatus;
  compact?: boolean;
  testID?: string;
}) {
  const history = HISTORY_PILL[status];
  const sizeClass = compact ? "h-[22px]" : "h-6";

  if (history) {
    return (
      <View
        testID={testID}
        className={`${sizeClass} flex-row items-center gap-[5px] rounded-full pl-[7px] pr-[9px]`}
        style={{ backgroundColor: history.bg }}
      >
        <history.Icon size={12} color={history.fg} strokeWidth={2} />
        <Text className="font-sans-semibold text-[12px]" style={{ color: history.fg }}>
          {tripStatusLabel(status)}
        </Text>
      </View>
    );
  }

  const live = status === TripStatus.ACTIVE;
  return (
    <View
      testID={testID}
      // En modo oscuro el fondo negro de "En curso" igualaría al de la card: se le suma un borde.
      className={`${sizeClass} flex-row items-center gap-1.5 rounded-full px-2.5 ${
        live ? "border border-transparent bg-ink-950 dark:border-border-strong" : "bg-lime-200"
      }`}
    >
      {live ? <PulseDot testID="trip-status-dot" /> : null}
      <Text className={`font-sans-semibold text-[12px] ${live ? "text-lime-500" : "text-ink-700"}`}>
        {tripStatusLabel(status)}
      </Text>
    </View>
  );
}
