import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router } from "expo-router";
import { AlertCircle, Clock } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  formatPickupDateLabel,
  formatPickupWindowLabel,
  formatReceiverConfirmationDeadline,
  shortAddressLabel,
} from "../../src/lib/shipment-format";
import { useAuthStore } from "../../src/store/auth-store";
import { ShipmentStatusBadge } from "./status-badge";

export interface ShipmentCardProps {
  shipment: ShipmentSummary;
  testID?: string;
}

/**
 * Card de envío para el listado completo "Mis Envíos" (MOVO-127 / MOVO-132).
 * Distingue el rol del usuario (emisor vs receptor) y destaca envíos recibidos
 * pendientes de confirmación con su plazo restante.
 */
export function ShipmentCard({ shipment, testID }: ShipmentCardProps) {
  const colors = useThemeColors();
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const isReceiver = currentUserId === shipment.receiverId;
  const pickupDateLabel = formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate;
  const windowLabel = formatPickupWindowLabel(shipment.pickupTimeWindowStart, shipment.pickupTimeWindowEnd);
  const deadlineLabel =
    isReceiver &&
    shipment.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
    shipment.receiverConfirmationDeadline
      ? formatReceiverConfirmationDeadline(shipment.receiverConfirmationDeadline)
      : null;

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(`/shipments/${shipment.id}`)}
      className="gap-3.5 rounded-[16px] border border-border bg-bg-sub p-4"
    >
      <View className="flex-row items-center justify-between">
        <View
          testID={testID ? `${testID}-role-tag` : undefined}
          className={`rounded-md px-2 py-0.5 ${isReceiver ? "bg-info-100" : "bg-bg-mute"}`}
        >
          <Text className={`font-sans-medium text-[11px] ${isReceiver ? "text-info-700" : "text-fg-2"}`}>
            {isReceiver ? "Recibís" : "Enviás"}
          </Text>
        </View>
        <ShipmentStatusBadge status={shipment.status} isReceiver={isReceiver} />
      </View>

      <View className="flex-row items-center gap-2">
        <View className="h-2 w-2 rounded-full bg-fg" />
        <Text numberOfLines={1} className="font-sans-medium text-small text-fg">
          {shortAddressLabel(shipment.pickupAddress)}
        </Text>
        <View className="h-px flex-1 bg-border" />
        <Text numberOfLines={1} className="font-sans-medium text-small text-fg">
          {shortAddressLabel(shipment.deliveryAddress)}
        </Text>
        <View className="h-2 w-2 rounded-full bg-lime-500" />
      </View>

      {deadlineLabel ? (
        <View
          testID={testID ? `${testID}-deadline` : undefined}
          className="flex-row items-center gap-1.5 rounded-lg bg-warning-100/70 px-2.5 py-1.5"
        >
          <AlertCircle size={13} strokeWidth={1.8} color="#B45309" />
          <Text className="font-sans-medium text-[12px] text-warning-700">{deadlineLabel}</Text>
        </View>
      ) : null}

      <View className="flex-row items-center gap-1.5">
        <Clock size={13} strokeWidth={1.8} color={colors.fg3} />
        <Text className="font-sans text-caption text-fg-3">
          {pickupDateLabel} · {windowLabel}
        </Text>
      </View>
    </Pressable>
  );
}
