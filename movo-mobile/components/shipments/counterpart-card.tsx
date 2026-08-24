import {
  CheckCircle2,
  Clock,
  XCircle,
  type LucideIcon,
} from "lucide-react-native";
import { Text, View } from "react-native";
import { AvatarImage } from "../ui/avatar-image";
import { SkeletonBlock } from "../ui/skeleton-block";
import { ProfileVerifiedBadge } from "../profile/profile-verified-badge";
import { usePublicProfile } from "../../src/hooks/use-profile";

export type ReceiverConfirmationStatus = "pending" | "confirmed" | "rejected";

const RECEIVER_CONFIRMATION_META: Record<
  ReceiverConfirmationStatus,
  { label: string; Icon: LucideIcon; iconColor: string; className: string }
> = {
  pending: {
    label: "Pend. de aceptar",
    Icon: Clock,
    iconColor: "#A97714",
    className: "bg-warning-100 text-warning-700",
  },
  confirmed: {
    label: "Aceptó el envío",
    Icon: CheckCircle2,
    iconColor: "#16754A",
    className: "bg-success-100 text-success-700",
  },
  rejected: {
    label: "Rechazó el envío",
    Icon: XCircle,
    iconColor: "#972327",
    className: "bg-danger-100 text-danger-700",
  },
};

export interface CounterpartCardProps {
  userId: string;
  /** Solo para el receptor cuando quien mira es el emisor (AC7 de MOVO-127, feedback post-QA):
   * si el receptor todavía no confirmó, rechazó, o ya confirmó el envío — derivado de
   * `shipment.status` por el caller (`AWAITING_RECEIVER_CONFIRMATION`/
   * `REJECTED_BY_RECEIVER`/cualquier otro estado posterior), esta card no conoce el
   * enum de estados del envío. `undefined` (emisor o transportista) no muestra badge. */
  receiverConfirmation?: ReceiverConfirmationStatus;
  /** Etiqueta de la sección ("Emisor"/"Receptor"/"Transportista") — la card no la muestra, la
   * pinta el caller vía `Eyebrow` (mismo patrón que `RouteMapCard`/`PackageCard`, cada
   * card es solo el contenido, el título de sección vive afuera). */
  testID?: string;
}

/**
 * Card de contraparte del envío (AC7 de MOVO-127, MOVO-131) — reusada para el receptor
 * (`shipment.receiverId`), el emisor (`shipment.senderId`, cuando el usuario es el
 * receptor) y el transportista (`shipment.carrierId`, cuando existe).
 * Sin rating: `reputationScore` de `PublicProfile` es siempre `null` hoy (MOVO-25
 * pendiente), mostrar un "★ —" vacío sería peor que no mostrar nada.
 */
export function CounterpartCard({
  userId,
  receiverConfirmation,
  testID,
}: CounterpartCardProps) {
  const { data: profile, isLoading, isError } = usePublicProfile(userId);

  if (isLoading) {
    return (
      <View
        testID={testID}
        className="flex-row items-center gap-3 rounded-[14px] border border-border bg-bg px-4 py-3.5"
      >
        <SkeletonBlock className="h-10 w-10 rounded-full" />
        <View className="flex-1 gap-1.5">
          <SkeletonBlock className="h-3.5 w-32 rounded-md" />
          <SkeletonBlock className="h-3 w-24 rounded-md" />
        </View>
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View
        testID={testID}
        className="rounded-[14px] border border-border bg-bg px-4 py-3.5"
      >
        <Text className="font-sans text-small text-fg-3">
          No pudimos cargar este perfil.
        </Text>
      </View>
    );
  }

  const confirmation = receiverConfirmation
    ? RECEIVER_CONFIRMATION_META[receiverConfirmation]
    : null;
  const [confirmationBg, confirmationText] = confirmation
    ? confirmation.className.split(" ")
    : [];

  return (
    <View
      testID={testID}
      className="flex-row items-center gap-3 rounded-[14px] border border-border bg-bg px-4 py-3.5"
    >
      <AvatarImage
        fullName={profile.fullName}
        photoUrl={profile.photoUrl}
        size={40}
      />
      <View className="flex-1">
        <Text className="font-sans-semibold text-[14px] text-fg">
          {profile.fullName}
        </Text>
        {profile.isVerified ? <ProfileVerifiedBadge /> : null}
      </View>
      {confirmation ? (
        <View
          className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${confirmationBg}`}
        >
          <confirmation.Icon
            size={11}
            color={confirmation.iconColor}
            strokeWidth={2.2}
          />
          <Text className={`font-sans-medium text-[11px] ${confirmationText}`}>
            {confirmation.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
