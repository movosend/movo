import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  CircleSlash,
  Clock,
  Megaphone,
  PackageCheck,
  PackagePlus,
  Truck,
  UserCheck,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import { ShipmentStatus as Status } from "@movo/shared/dist/types/shipment";
import type { ShipmentEvent } from "../../src/api/shipments-client";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useShipmentRatings } from "../../src/hooks/use-ratings";
import { useShipmentEvents } from "../../src/hooks/use-shipments";
import { useShipmentReceiverTransfers } from "../../src/hooks/use-receiver-transfers";
import {
  receiverTransferDetail,
  receiverTransferMeta,
  receiverTransferQuote,
  receiverTransferStatusPill,
  receiverTransferSteps,
  receiverTransferTitle,
  receiverTransferViewer,
  type ReceiverTransferTone,
} from "../../src/lib/receiver-transfer-format";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { Rating } from "../../src/api/ratings-client";
import { StarRatingInput } from "../ui/star-rating-input";
import { getFirstName } from "../../src/lib/profile-format";
import { useAuthStore } from "../../src/store/auth-store";
import {
  formatEventTimestamp,
  remainingLifecycleSteps,
  shipmentActorLabel,
  shipmentEventDetail,
  shipmentEventTitle,
  shipmentPendingStepLabel,
  shouldShowEventReason,
  shipmentStatusTone,
} from "../../src/lib/shipment-format";
import { ErrorBanner } from "../ui/error-banner";
import { SkeletonBlock } from "../ui/skeleton-block";

const EVENT_ICON: Record<ShipmentStatus, LucideIcon> = {
  [Status.AWAITING_RECEIVER_CONFIRMATION]: Clock,
  [Status.REJECTED_BY_RECEIVER]: CircleSlash,
  [Status.PUBLISHED]: Megaphone,
  // Entrar a `assignment_pending`/`assigned_unfunded` es aceptar una oferta, o sea elegir
  // al transportista (retiro cercano o lejano, MOVO-208).
  [Status.ASSIGNMENT_PENDING]: UserCheck,
  [Status.ASSIGNED_UNFUNDED]: UserCheck,
  // Pasar a `assigned` es reservar el pago: el transportista ya estaba elegido.
  [Status.ASSIGNED]: Wallet,
  [Status.IN_TRANSIT]: Truck,
  [Status.DELIVERED]: PackageCheck,
  // MOVO-208: entregado y pago liberado (MOVO-212) -- inalcanzable hasta esa historia.
  [Status.COMPLETED]: BadgeCheck,
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
   * (ver `shipmentActorLabel`) — el detalle ya tiene los tres ids cargados.
   * `formerReceiverId`/`formerReceiverName` (MOVO-275): quien le pasó la recepción a otra
   * persona, para que sus eventos (aceptar el envío) lleven su nombre y no el del
   * receptor vigente. */
  parties: {
    senderId: string;
    receiverId: string;
    carrierId: string | null;
    formerReceiverId?: string | null;
    formerReceiverName?: string | null;
  };
  testID?: string;
}

function TimelineSkeleton({ testID }: { testID?: string }) {
  return (
    <View testID={testID} className="pt-2">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className="min-h-[56px] flex-row gap-3.5 pb-5">
          <SkeletonBlock className="h-9 w-9 rounded-full" />
          <View className="flex-1 gap-2 pt-2">
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
  title,
  children,
}: {
  Icon: LucideIcon;
  iconColor: string;
  circleClass: string;
  railClass: string;
  isLast: boolean;
  /** Sin `title`, el contenido arranca a la altura del círculo (el item de transferencia
   * es una card con su propio título adentro). */
  title?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    // Ritmo fijo: el alto de cada fila lo define su contenido con un `min-h` de piso,
    // sin repartirse el alto de la pantalla — con pocos pasos, estirar las filas para
    // llenar la vista deja huecos enormes entre eventos.
    <View className={`flex-row gap-3.5 ${isLast ? "" : "min-h-[56px]"}`}>
      <View className="items-center">
        <View className={`h-9 w-9 items-center justify-center rounded-full ${circleClass}`}>
          <Icon size={16} color={iconColor} strokeWidth={1.9} />
        </View>
        {/* El riel se dibuja como parte de la fila (no como una línea absoluta de alto
            fijo detrás de todas): así se estira hasta el alto real de la fila, que
            varía según el evento tenga o no `reason`. */}
        {isLast ? null : <View className={`my-1 w-px flex-1 ${railClass}`} />}
      </View>
      <View className={`flex-1 ${isLast ? "" : "pb-5"}`}>
        {/* El título vive en una caja del mismo alto que el círculo y centrado en
            ella: así queda alineado con el icono por construcción, sin depender de un
            padding calculado a mano contra el line-height — que se rompía apenas la
            fila tenía una segunda línea (fecha/actor) debajo. */}
        {title !== undefined ? <View className="h-9 justify-center">{title}</View> : null}
        {children}
      </View>
    </View>
  );
}

function EventRow({
  event,
  isCurrent,
  isLast,
  parties,
  currentUserId,
  receiverFirstName,
  carrierFirstName,
  isReceiver,
}: {
  event: ShipmentEvent;
  isCurrent: boolean;
  isLast: boolean;
  parties: TimelineSectionProps["parties"];
  currentUserId: string | null;
  receiverFirstName: string | null;
  carrierFirstName: string | null;
  isReceiver: boolean;
}) {
  const colors = useThemeColors();
  const tone = TONE_STYLE[shipmentStatusTone(event.toStatus)];
  const timestamp = formatEventTimestamp(event.createdAt);
  // MOVO-253: tras elegir otro receptor, `parties.receiverId` es el receptor NUEVO — un
  // rechazo anterior lo hizo otra persona y no puede tomar su nombre ni su rol.
  const isFormerReceiverRejection =
    event.toStatus === Status.REJECTED_BY_RECEIVER &&
    event.actorId !== null &&
    event.actorId !== parties.receiverId;
  // MOVO-275: el receptor que transfirió la recepción ya no es `parties.receiverId`; sus
  // eventos (aceptar el envío) llevan su nombre, no el del receptor vigente.
  const isTransferredReceiverEvent =
    !!parties.formerReceiverId && event.actorId === parties.formerReceiverId;
  const formerReceiverFirstName = getFirstName(parties.formerReceiverName) || null;
  const actor = isFormerReceiverRejection
    ? "Receptor anterior"
    : isTransferredReceiverEvent && event.actorId !== currentUserId
      ? formerReceiverFirstName ?? "Receptor anterior"
      : shipmentActorLabel(event.actorId, parties, currentUserId, {
          receiverName: receiverFirstName,
        });
  const detail = shipmentEventDetail(event.toStatus, event.fromStatus);

  return (
    <TimelineRow
      Icon={EVENT_ICON[event.toStatus] ?? Clock}
      iconColor={tone.iconColor ?? colors.fg3}
      circleClass={tone.bgClass}
      railClass="bg-border"
      isLast={isLast}
      title={
        <Text className={`font-sans-semibold text-body ${isCurrent ? "text-fg" : "text-fg-2"}`}>
          {shipmentEventTitle(event.toStatus, event.fromStatus, {
            receiverName: isFormerReceiverRejection
              ? "El receptor anterior"
              : isTransferredReceiverEvent
                ? formerReceiverFirstName
                : receiverFirstName,
            isReceiver:
              (isReceiver || isTransferredReceiverEvent) &&
              event.actorId !== null &&
              event.actorId === currentUserId,
            isSender: currentUserId !== null && currentUserId === parties.senderId,
            isCarrier: currentUserId !== null && currentUserId === parties.carrierId,
            carrierName: carrierFirstName,
          })}
        </Text>
      }
    >
      <View className="flex-row items-center gap-1.5">
        {timestamp ? <Text className="font-sans text-small text-fg-3">{timestamp}</Text> : null}
        {actor ? (
          <>
            {timestamp ? <Text className="font-sans text-small text-fg-3">·</Text> : null}
            <Text className="font-sans text-small text-fg-3">{actor}</Text>
          </>
        ) : null}
      </View>
      {detail ? <Text className="mt-1 font-sans text-small text-fg-3">{detail}</Text> : null}
      {event.reason && shouldShowEventReason(event.toStatus) ? (
        <Text className="mt-2 font-sans text-small text-fg-2">{event.reason}</Text>
      ) : null}
    </TimelineRow>
  );
}

/** Paso que todavía no ocurrió: círculo vacío con borde punteado (nunca relleno con
 * el tono semántico del estado — el color se gana al pasar de verdad), texto en
 * `fg-3` y sin fecha ni actor, porque no hay ninguno que mostrar. */
function PendingStepRow({
  status,
  isLast,
  receiverFirstName,
  isReceiver,
}: {
  status: ShipmentStatus;
  isLast: boolean;
  receiverFirstName: string | null;
  isReceiver: boolean;
}) {
  const colors = useThemeColors();

  return (
    <TimelineRow
      Icon={EVENT_ICON[status] ?? Clock}
      iconColor={colors.fg3}
      circleClass="border border-dashed border-border-strong bg-bg-sub"
      railClass="bg-border"
      isLast={isLast}
      title={
        <Text className="font-sans-medium text-body text-fg-3">
          {shipmentPendingStepLabel(status, { receiverName: receiverFirstName, isReceiver })}
        </Text>
      }
    />
  );
}

/** Colores del item de transferencia, fieles al prototipo de MOVO-275: el círculo se pinta
 * solo mientras espera respuesta (ámbar) o cuando se completó (lima); el resto queda gris y
 * el estado lo cuenta la pill. */
const TRANSFER_TONE: Record<ReceiverTransferTone, { circle: string; icon: string | null; pill: string; pillText: string }> = {
  warning: { circle: "bg-warning-500", icon: "#0A0A0B", pill: "bg-warning-200", pillText: "text-warning-700" },
  success: { circle: "bg-lime-500", icon: "#0A0A0B", pill: "bg-success-100", pillText: "text-success-700" },
  danger: { circle: "bg-bg-mute", icon: null, pill: "bg-danger-100", pillText: "text-danger-700" },
  neutral: { circle: "bg-bg-mute", icon: null, pill: "bg-bg-mute", pillText: "text-fg-2" },
};

/**
 * MOVO-275 AC7: un solo item por solicitud de transferencia de receptor, como card dentro
 * del riel: título y pill de estado arriba, fecha, resultado y motivo. La completada se
 * destaca con borde oscuro y muestra sus pasos (pedido, aceptación, cambio de receptor).
 * El texto depende de quién mira (`receiverTransferViewer`).
 */
function ReceiverTransferRow({
  transfer,
  senderId,
  currentUserId,
  isLast,
  testID,
}: {
  transfer: ReceiverTransferRequest;
  senderId: string;
  currentUserId: string | null;
  isLast: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const viewer = receiverTransferViewer(transfer, currentUserId, senderId);
  const pill = receiverTransferStatusPill(transfer);
  const tone = TRANSFER_TONE[pill.tone];
  const isCompleted = transfer.status === "completed";
  const meta = isCompleted ? null : receiverTransferMeta(transfer);
  const detail = isCompleted ? null : receiverTransferDetail(transfer, viewer);
  const quote = receiverTransferQuote(transfer);
  const steps = isCompleted ? receiverTransferSteps(transfer, viewer) : [];

  return (
    <TimelineRow
      Icon={ArrowLeftRight}
      iconColor={tone.icon ?? colors.fg3}
      circleClass={tone.circle}
      railClass="bg-border"
      isLast={isLast}
    >
      <View
        testID={testID}
        className={`gap-1.5 rounded-[14px] bg-bg px-3.5 py-3 ${isCompleted ? "border-[1.5px] border-fg" : "border border-border"}`}
      >
        <View className="flex-row items-start gap-2">
          <Text className="flex-1 font-sans-semibold text-[14px] leading-5 text-fg">
            {receiverTransferTitle(transfer, viewer)}
          </Text>
          <View className={`mt-px rounded-full px-2 py-0.5 ${tone.pill}`}>
            <Text testID={testID ? `${testID}-status` : undefined} className={`font-sans-semibold text-[11px] ${tone.pillText}`}>
              {pill.label}
            </Text>
          </View>
        </View>
        {meta ? <Text className="font-sans text-[12px] text-fg-3">{meta}</Text> : null}
        {detail ? (
          <Text testID={testID ? `${testID}-detail` : undefined} className="font-sans text-[13px] leading-[18px] text-fg-2">
            {detail}
          </Text>
        ) : null}
        {quote ? (
          <Text testID={testID ? `${testID}-quote` : undefined} className="font-sans text-[13px] leading-[18px] text-fg-2">
            “{quote}”
          </Text>
        ) : null}
        {steps.length > 0 ? (
          <View testID={testID ? `${testID}-steps` : undefined} className="mt-1 gap-2 border-t border-border pt-2.5">
            {steps.map((step) => (
              <View key={step.key} className="flex-row gap-2.5">
                <Text className="min-w-[40px] font-mono-medium text-[12px] leading-[18px] text-fg-3">{step.time ?? ""}</Text>
                <Text className="flex-1 font-sans text-[13px] leading-[18px] text-fg">{step.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </TimelineRow>
  );
}

function TimelineRatingCard({
  rating,
  parties,
  currentUserId,
  testID,
}: {
  rating: Rating;
  parties: { senderId: string; receiverId: string; carrierId: string | null };
  currentUserId: string | null;
  testID?: string;
}) {
  const { data: raterProfile } = usePublicProfile(rating.raterId);
  const { data: rateeProfile } = usePublicProfile(rating.rateeId);

  const isRaterMe = currentUserId === rating.raterId;
  const isRateeMe = currentUserId === rating.rateeId;

  const raterName = isRaterMe ? "Vos" : (raterProfile?.fullName ?? "Usuario");
  const rateeName = isRateeMe ? "vos" : (rateeProfile?.fullName ?? "usuario");

  const roleLabelMap: Record<string, string> = {
    sender: "Emisor",
    carrier: "Transportista",
    receiver: "Receptor",
  };
  const roleLabel = roleLabelMap[rating.role] ?? "";

  return (
    <View
      testID={testID}
      className="rounded-2xl border border-border bg-bg-mute p-3.5 gap-2"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2 flex-1 pr-2">
          <StarRatingInput score={rating.score} readOnly size={15} gap={3} />
          <Text className="font-sans-semibold text-[13px] text-fg">
            {rating.score} / 5
          </Text>
        </View>
        <Text className="font-sans text-[11px] text-fg-3">
          {formatEventTimestamp(rating.createdAt)}
        </Text>
      </View>

      <Text className="font-sans text-[13px] text-fg-2">
        <Text className="font-sans-medium text-fg">{raterName}</Text> calificó a{" "}
        <Text className="font-sans-medium text-fg">{rateeName}</Text>
        {roleLabel ? ` (${roleLabel})` : ""}
      </Text>

      {rating.comment ? (
        <Text className="font-sans text-[13px] text-fg-2 italic leading-4 pl-1">
          "{rating.comment}"
        </Text>
      ) : null}
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
  // MOVO-275: si falla, la línea de tiempo se muestra igual, sin las transferencias.
  const { data: transfers } = useShipmentReceiverTransfers(shipmentId);
  const { data: ratings } = useShipmentRatings(shipmentId);
  const { data: receiverProfile } = usePublicProfile(parties.receiverId);
  const { data: carrierProfile } = usePublicProfile(parties.carrierId ?? undefined);
  const currentUserId = useAuthStore((state) => state.user?.userId ?? null);
  const isReceiver = Boolean(currentUserId && currentUserId === parties.receiverId);
  const rawReceiverFirstName = getFirstName(receiverProfile?.fullName) || null;
  const receiverFirstName = isReceiver ? null : rawReceiverFirstName;
  const carrierFirstName = getFirstName(carrierProfile?.fullName) || null;
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

  // MOVO-275 AC7: las solicitudes de transferencia se intercalan por fecha con los
  // eventos de estado (vienen de su propia entidad, no de `shipment_events`).
  const lastEventId = events[events.length - 1].id;
  const items: Array<{ kind: "event"; at: string; event: ShipmentEvent } | { kind: "transfer"; at: string; transfer: ReceiverTransferRequest }> = [
    ...events.map((event) => ({ kind: "event" as const, at: event.createdAt, event })),
    ...(transfers ?? []).map((transfer) => ({ kind: "transfer" as const, at: transfer.createdAt, transfer })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const nothingAfterItems = pendingSteps.length === 0 && (!ratings || ratings.length === 0);

  return (
    <ScrollView testID={testID} className="flex-1" contentContainerClassName="pb-6 pt-2">
      {items.map((item, index) => {
        const isLast = index === items.length - 1 && nothingAfterItems;
        if (item.kind === "transfer") {
          return (
            <ReceiverTransferRow
              key={`transfer-${item.transfer.id}`}
              transfer={item.transfer}
              senderId={parties.senderId}
              currentUserId={currentUserId}
              isLast={isLast}
              testID={testID ? `${testID}-transfer-${item.transfer.id}` : undefined}
            />
          );
        }
        return (
          <EventRow
            key={item.event.id}
            event={item.event}
            isCurrent={item.event.id === lastEventId}
            isLast={isLast}
            parties={parties}
            currentUserId={currentUserId}
            receiverFirstName={receiverFirstName}
            carrierFirstName={carrierFirstName}
            isReceiver={isReceiver}
          />
        );
      })}
      {pendingSteps.map((status, index) => (
        <PendingStepRow
          key={status}
          status={status}
          isLast={index === pendingSteps.length - 1 && (!ratings || ratings.length === 0)}
          receiverFirstName={receiverFirstName}
          isReceiver={isReceiver}
        />
      ))}
      {ratings && ratings.length > 0 ? (
        <View testID="timeline-ratings-section" className="mt-5 pt-4 border-t border-border gap-3">
          <Text className="font-sans-medium text-caption uppercase text-fg-3">
            Calificaciones ({ratings.length})
          </Text>
          {ratings.map((rating) => (
            <TimelineRatingCard
              key={rating.id}
              rating={rating}
              parties={parties}
              currentUserId={currentUserId}
              testID={`timeline-rating-${rating.id}`}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
