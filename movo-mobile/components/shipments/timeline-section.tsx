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
  remainingLifecycleSteps,
  shipmentActorLabel,
  shipmentEventTitle,
  shipmentPendingStepLabel,
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
    <View testID={testID} className="pt-2">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className="min-h-[84px] flex-row gap-3.5">
          <SkeletonBlock className="h-9 w-9 rounded-full" />
          <View className="flex-1 gap-2 pt-[7px]">
            <SkeletonBlock className="h-4 w-44 rounded-md" />
            <SkeletonBlock className="h-3 w-28 rounded-md" />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Estructura común de una fila (círculo + riel + contenido) — compartida entre los
 * eventos ya ocurridos y los pasos futuros, para que ambos queden alineados sobre el
 * mismo riel aunque su relleno visual sea distinto. */
function TimelineRow({
  Icon,
  iconColor,
  circleClass,
  railClass,
  isLast,
  children,
}: {
  Icon: LucideIcon;
  iconColor: string;
  circleClass: string;
  railClass: string;
  isLast: boolean;
  children: React.ReactNode;
}) {
  return (
    // Todas las filas menos la última crecen por igual (`flex-1`) dentro de un
    // contenedor que ocupa el alto de la pantalla: con pocos pasos —el caso normal, un
    // envío tiene entre 2 y 6— la línea se reparte el espacio vertical en vez de
    // quedar apelotonada arriba. `min-h` es el piso cuando sí hay que scrollear
    // (muchos eventos, o eventos con `reason` largo).
    <View className={`flex-row gap-3.5 ${isLast ? "" : "min-h-[84px] flex-1"}`}>
      <View className="items-center">
        <View className={`h-9 w-9 items-center justify-center rounded-full ${circleClass}`}>
          <Icon size={16} color={iconColor} strokeWidth={1.9} />
        </View>
        {/* El riel se dibuja como parte de la fila (no como una línea absoluta de alto
            fijo detrás de todas): así se estira hasta el alto real de la fila, tanto
            si lo define el contenido (un `reason` largo) como el reparto vertical. */}
        {isLast ? null : <View className={`my-1 w-px flex-1 ${railClass}`} />}
      </View>
      {/* `pt-[7px]` centra la primera línea de texto (22px de line-height) contra el
          círculo de 36px, en vez de dejarla pegada a su borde superior. */}
      <View className={`flex-1 pt-[7px] ${isLast ? "" : "pb-4"}`}>{children}</View>
    </View>
  );
}

function EventRow({
  event,
  isCurrent,
  isLast,
  parties,
  currentUserId,
}: {
  event: ShipmentEvent;
  isCurrent: boolean;
  isLast: boolean;
  parties: TimelineSectionProps["parties"];
  currentUserId: string | null;
}) {
  const colors = useThemeColors();
  const tone = TONE_STYLE[shipmentStatusTone(event.toStatus)];
  const timestamp = formatEventTimestamp(event.createdAt);
  const actor = shipmentActorLabel(event.actorId, parties, currentUserId);

  return (
    <TimelineRow
      Icon={EVENT_ICON[event.toStatus] ?? Clock}
      iconColor={tone.iconColor ?? colors.fg3}
      circleClass={tone.bgClass}
      railClass="bg-border"
      isLast={isLast}
    >
      <Text className={`font-sans-semibold text-body ${isCurrent ? "text-fg" : "text-fg-2"}`}>
        {shipmentEventTitle(event.toStatus, event.fromStatus)}
      </Text>
      <View className="mt-1 flex-row items-center gap-1.5">
        {timestamp ? <Text className="font-sans text-small text-fg-3">{timestamp}</Text> : null}
        {actor ? (
          <>
            {timestamp ? <Text className="font-sans text-small text-fg-3">·</Text> : null}
            <Text className="font-sans text-small text-fg-3">{actor}</Text>
          </>
        ) : null}
      </View>
      {event.reason ? (
        <Text className="mt-2 font-sans text-small text-fg-2">{event.reason}</Text>
      ) : null}
    </TimelineRow>
  );
}

/** Paso que todavía no ocurrió: círculo vacío con borde punteado (nunca relleno con
 * el tono semántico del estado — el color se gana al pasar de verdad), texto en
 * `fg-3` y sin fecha ni actor, porque no hay ninguno que mostrar. */
function PendingStepRow({ status, isLast }: { status: ShipmentStatus; isLast: boolean }) {
  const colors = useThemeColors();

  return (
    <TimelineRow
      Icon={EVENT_ICON[status] ?? Clock}
      iconColor={colors.fg3}
      circleClass="border border-dashed border-border-strong bg-bg-sub"
      railClass="bg-border"
      isLast={isLast}
    >
      <Text className="font-sans-medium text-body text-fg-3">{shipmentPendingStepLabel(status)}</Text>
    </TimelineRow>
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

  // Los pasos futuros se proyectan desde el último evento (el estado actual del
  // envío), no desde `shipment.status`: la línea de tiempo se lee entera contra una
  // sola fuente, así nunca puede mostrar un paso ya cumplido como pendiente si una de
  // las dos queries quedó desactualizada respecto de la otra.
  const pendingSteps = remainingLifecycleSteps(events[events.length - 1].toStatus);

  return (
    // `flex-grow` (no `flex-1`) en el contenido: el contenedor mide al menos el alto
    // visible —lo que habilita el reparto vertical de las filas— pero puede crecer más
    // y scrollear cuando los eventos no entran.
    <ScrollView testID={testID} className="flex-1" contentContainerClassName="flex-grow pb-6 pt-2">
      {events.map((event, index) => (
        <EventRow
          key={event.id}
          event={event}
          isCurrent={index === events.length - 1}
          isLast={index === events.length - 1 && pendingSteps.length === 0}
          parties={parties}
          currentUserId={currentUserId}
        />
      ))}
      {pendingSteps.map((status, index) => (
        <PendingStepRow key={status} status={status} isLast={index === pendingSteps.length - 1} />
      ))}
    </ScrollView>
  );
}
