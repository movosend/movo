import { CheckCircle2, ChevronRight, Clock, XCircle, type LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatReputationScore, getInitials } from "../../src/lib/profile-format";
import { AvatarImage } from "../ui/avatar-image";
import { SkeletonBlock } from "../ui/skeleton-block";
import type { ReceiverConfirmationStatus } from "./counterpart-card";

const RECEIVER_CONFIRMATION_META: Record<
  ReceiverConfirmationStatus,
  { label: string; Icon: LucideIcon; iconColor: string; bg: string; text: string }
> = {
  pending: { label: "Pendiente", Icon: Clock, iconColor: "#A97714", bg: "bg-warning-100", text: "text-warning-700" },
  confirmed: { label: "Aceptó", Icon: CheckCircle2, iconColor: "#16754A", bg: "bg-success-100", text: "text-success-700" },
  rejected: { label: "Rechazó", Icon: XCircle, iconColor: "#972327", bg: "bg-danger-100", text: "text-danger-700" },
};

export interface ShipmentPartyRowData {
  userId: string;
  /** "Emisor" / "Transportista" / "Receptor". */
  roleLabel: string;
  /** Estado de confirmación del receptor, solo cuando lo mira el emisor o el transportista. */
  receiverConfirmation?: ReceiverConfirmationStatus;
  /** Reemplaza la línea de rol por un texto propio (ej. "Receptor desde el 10 oct · antes, vos"). */
  note?: string;
  /** Avatar en lima: la persona que cambió en el envío (MOVO-275, receptor nuevo visto por el anterior). */
  highlight?: boolean;
  onPress?: () => void;
  testID?: string;
}

function PartyAvatar({ fullName, photoUrl, highlight }: { fullName: string; photoUrl: string | null; highlight?: boolean }) {
  if (highlight && !photoUrl) {
    return (
      <View className="h-10 w-10 items-center justify-center rounded-full bg-lime-500">
        <Text className="font-sans-semibold text-[13px] text-ink-950">{getInitials(fullName)}</Text>
      </View>
    );
  }
  return <AvatarImage fullName={fullName} photoUrl={photoUrl} size={40} />;
}

function PartyRow({ row, isFirst }: { row: ShipmentPartyRowData; isFirst: boolean }) {
  const colors = useThemeColors();
  const { data: profile, isLoading, isError } = usePublicProfile(row.userId);
  const divider = isFirst ? "" : "border-t border-border";

  if (isLoading) {
    return (
      <View testID={row.testID} className={`flex-row items-center gap-3 py-3 ${divider}`}>
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
      <View testID={row.testID} className={`py-3 ${divider}`}>
        <Text className="font-sans text-small text-fg-3">{row.roleLabel} · No pudimos cargar este perfil.</Text>
      </View>
    );
  }

  const hasReputation =
    !profile.isNewProfile && profile.reputationScore !== null && profile.reputationScore !== undefined;
  const subtitle =
    row.note ??
    [
      row.roleLabel,
      profile.isVerified ? "Identidad verificada" : null,
      hasReputation ? `${formatReputationScore(profile.reputationScore)} ★` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const confirmation = row.receiverConfirmation ? RECEIVER_CONFIRMATION_META[row.receiverConfirmation] : null;

  return (
    <Pressable
      testID={row.testID}
      onPress={row.onPress}
      disabled={!row.onPress}
      accessibilityRole={row.onPress ? "button" : undefined}
      accessibilityLabel={row.onPress ? `Ver perfil de ${profile.fullName}` : undefined}
      className={`flex-row items-center gap-3 py-3 ${divider} ${row.onPress ? "active:opacity-75" : ""}`}
    >
      <PartyAvatar fullName={profile.fullName} photoUrl={profile.photoUrl} highlight={row.highlight} />
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} className="font-sans-semibold text-[14px] text-fg">
          {profile.fullName}
        </Text>
        <Text testID={row.testID ? `${row.testID}-subtitle` : undefined} className="font-sans text-small text-fg-3">
          {subtitle}
        </Text>
      </View>
      {confirmation ? (
        <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${confirmation.bg}`}>
          <confirmation.Icon size={11} color={confirmation.iconColor} strokeWidth={2.2} />
          <Text className={`font-sans-medium text-[11px] ${confirmation.text}`}>{confirmation.label}</Text>
        </View>
      ) : null}
      {row.onPress ? <ChevronRight size={18} color={colors.fg3} strokeWidth={2} /> : null}
    </Pressable>
  );
}

/**
 * Las personas del envío en una sola card, una fila por persona (prototipo de MOVO-275,
 * mismo criterio que "Con quién tratás" de `transport/[id].tsx`). Quien mira no aparece:
 * cada fila es alguien con quien comparte el envío. Tocar una fila abre su perfil.
 */
export function ShipmentPartiesCard({ rows, testID }: { rows: ShipmentPartyRowData[]; testID?: string }) {
  if (rows.length === 0) return null;
  return (
    <View testID={testID} className="rounded-[14px] border border-border bg-bg px-4 py-1">
      {rows.map((row, index) => (
        <PartyRow key={`${row.roleLabel}-${row.userId}`} row={row} isFirst={index === 0} />
      ))}
    </View>
  );
}
