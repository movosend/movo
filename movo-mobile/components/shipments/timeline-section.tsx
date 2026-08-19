import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import {
  AlertTriangle,
  CircleSlash,
  Clock,
  Megaphone,
  PackageCheck,
  PackagePlus,
  Search,
  Truck,
  UserCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import { ShipmentStatus as Status } from "@movo/shared/dist/types/shipment";
import type { ShipmentEvent } from "../../src/api/shipments-client";
import { useShipmentEvents } from "../../src/hooks/use-shipments";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useAuthStore } from "../../src/store/auth-store";
import {
  formatEventTimestamp,
  shipmentActorLabel,
  shipmentEventTitle,
  shipmentStatusTone,
} from "../../src/lib/shipment-format";
import { ErrorBanner } from "../ui/error-banner";
import { SkeletonBlock } from "../ui/skeleton-block";

const EVENT_ICON: Record<ShipmentStatus, LucideIcon> = {
  [Status.AWAITING_RECEIVER_CONFIRMATION]: Clock,
  [Status.REJECTED_BY_RECEIVER]: CircleSlash,
  [Status.PUBLISHED]: Megaphone,
  [Status.ASSIGNMENT_PENDING]: Search,
  [Status.ASSIGNED]: UserCheck,
  [Status.IN_TRANSIT]: Truck,
  [Status.DELIVERED]: PackageCheck,
  [Status.CANCELLED]: XCircle,
  [Status.DISPUTED]: AlertTriangle,
};

/** Mismo mapa de tonos que `ShipmentStatusBadge`, pero acá se necesita el hex del
 * icono además de la clase de fondo (los iconos de lucide reciben `color` en JS, no
 * className — mismo criterio que `CounterpartCard`). */
const TONE_STYLE: Record<
  ReturnType<typeof shipmentStatusTone>,
  { bgClass: string; iconColor: string | null }
> = {
  success: { bgClass: "bg-success-100", iconColor: "#16754A" },
  warning: { bgClass: "bg-warning-100", iconColor: "#A97714" },
  danger: { bgClass: "bg-danger-100", iconColor: "#972327" },
  info: { bgClass: "bg-info-100", iconColor: "#173EA3" },
  // Único tono sin hex propio: su fondo (`bg-mute`) sí cambia con el tema, así que el
  // icono tiene que seguir a `fg-3` en vez de quedar fijo en el valor light.
  neutral: { bgClass: "bg-bg-mute", iconColor: null },
};

export interface TimelineSectionProps {
  shipmentId: string;
  /** Partes del envío, para resolver `actorId` a un rol sin pedir `GET /users/:id`
   * (ver `shipmentActorLabel`) — el detalle ya tiene los tres ids cargados. */
  parties: { senderId: string; receiverId: string; carrierId: string | null };
  testID?: string;
}

function TimelineSkeleton({ testID }: { testID?: string }) {
  return (
    <View testID={testID} className="gap-5 pt-1">
      {[0, 1, 2].map((i) => (
        <View key={i} className="flex-row gap-3">
          <SkeletonBlock className="h-8 w-8 rounded-full" />
          <View className="flex-1 gap-1.5 pt-1">
            <SkeletonBlock className="h-3.5 w-40 rounded-md" />
            <SkeletonBlock className="h-3 w-24 rounded-md" />
          </View>
        </View>
      ))}
    </View>
  );
}

function TimelineRow({
  event,
  isLast,
  parties,
  currentUserId,
}: {
  event: ShipmentEvent;
  isLast: boolean;
  parties: TimelineSectionProps["parties"];
  currentUserId: string | null;
}) {
  const colors = useThemeColors();
  const tone = TONE_STYLE[shipmentStatusTone(event.toStatus)];
  const Icon = EVENT_ICON[event.toStatus] ?? Clock;
  const timestamp = formatEventTimestamp(event.createdAt);
  const actor = shipmentActorLabel(event.actorId, parties, currentUserId);

  return (
    <View className="flex-row gap-3">
      <View className="items-center">
        <View className={`h-8 w-8 items-center justify-center rounded-full ${tone.bgClass}`}>
          <Icon size={15} color={tone.iconColor ?? colors.fg3} strokeWidth={1.9} />
        </View>
        {/* El riel se dibuja como parte de la fila (no como una línea absoluta de alto
            fijo detrás de todas): así se estira solo hasta el alto real del contenido
            de cada evento, que varía según tenga o no `reason`. */}
        {isLast ? null : <View className="w-px flex-1 bg-border" />}
      </View>
      <View className={`flex-1 ${isLast ? "" : "pb-5"}`}>
        <Text
          className={`font-sans-semibold text-[14px] ${isLast ? "text-fg" : "text-fg-2"}`}
        >
          {shipmentEventTitle(event.toStatus, event.fromStatus)}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-1.5">
          {timestamp ? <Text className="font-sans text-[12px] text-fg-3">{timestamp}</Text> : null}
          {actor ? (
            <>
              {timestamp ? <Text className="font-sans text-[12px] text-fg-3">·</Text> : null}
              <Text className="font-sans text-[12px] text-fg-3">{actor}</Text>
            </>
          ) : null}
        </View>
        {event.reason ? (
          <Text className="mt-1.5 font-sans text-[12px] leading-[17px] text-fg-2">{event.reason}</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Línea de tiempo del detalle de envío (AC6 de MOVO-127), ahora sí contra datos
 * reales: consume `GET /shipments/:id/events` (MOVO-128, mergeado a `develop`) en vez
 * del estado vacío "próximamente" que tenía mientras ese endpoint no existía. Los
 * eventos llegan en orden cronológico ascendente y se muestran en ese mismo orden —
 * el último es el estado actual del envío, destacado con texto `fg` (el resto queda en
 * `fg-2`). Nunca se sintetizan eventos a partir de `status`/`lastStatusChangedAt`: si
 * el historial viene vacío, se dice que está vacío.
 */
export function TimelineSection({ shipmentId, parties, testID }: TimelineSectionProps) {
  const { data: events, isLoading, isError, refetch } = useShipmentEvents(shipmentId);
  const currentUserId = useAuthStore((state) => state.user?.userId ?? null);
  const colors = useThemeColors();

  if (isLoading) {
    return <TimelineSkeleton testID={testID} />;
  }

  if (isError) {
    return (
      <View testID={testID}>
        <ErrorBanner message="No pudimos cargar la línea de tiempo." />
        <Text onPress={() => refetch()} className="mt-3 font-sans-medium text-small text-fg">
          Reintentar
        </Text>
      </View>
    );
  }

  if (!events || events.length === 0) {
    return (
      <View
        testID={testID}
        className="items-center gap-2 rounded-[14px] border border-dashed border-border-strong bg-bg-sub px-4 py-6"
      >
        <Clock size={20} color={colors.fg3} strokeWidth={1.8} />
        <Text className="text-center font-sans-medium text-[13px] text-fg-3">
          Todavía no hay movimientos registrados
        </Text>
      </View>
    );
  }

  return (
    <ScrollView testID={testID} className="flex-1" contentContainerClassName="pb-6 pt-1">
      {events.map((event, index) => (
        <TimelineRow
          key={event.id}
          event={event}
          isLast={index === events.length - 1}
          parties={parties}
          currentUserId={currentUserId}
        />
      ))}
    </ScrollView>
  );
}
