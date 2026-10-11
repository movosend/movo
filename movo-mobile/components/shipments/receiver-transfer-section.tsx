import { RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES } from "@movo/shared/dist/types/receiver-transfer";
import { router } from "expo-router";
import { ArrowLeftRight, ChevronRight, Lock } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { getFirstName } from "../../src/lib/profile-format";

interface ReceiverTransferSectionProps {
  shipment: Pick<ShipmentSummary, "id" | "status" | "receiverTransfer">;
  currentUserId: string;
  testID?: string;
}

/**
 * MOVO-275 AC8: sección "Recepción" del detalle, solo para el receptor vigente. Según
 * el estado de la transferencia muestra la acción "Que lo reciba otra persona" o que ya
 * no se puede volver a transferir. La solicitud pendiente propia no va acá: es el aviso
 * `ReceiverTransferPendingBanner`, arriba del mapa.
 */
export function ReceiverTransferSection({ shipment, currentUserId, testID }: ReceiverTransferSectionProps) {
  const colors = useThemeColors();
  const pending = shipment.receiverTransfer?.pending ?? null;
  const completed = shipment.receiverTransfer?.completed ?? null;

  const eyebrow = (
    <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">Recepción</Text>
  );

  // La solicitud propia pendiente se muestra como aviso arriba del mapa (`ReceiverTransferPendingBanner`).
  if (pending && pending.requestedBy === currentUserId) return null;

  if (completed) {
    const requester = getFirstName(completed.requesterName) || "El receptor anterior";
    return (
      <View testID={testID}>
        {eyebrow}
        <View
          testID={testID ? `${testID}-used` : undefined}
          className="flex-row items-start gap-3 rounded-[14px] border border-border bg-bg-sub px-3.5 py-3"
        >
          <Lock size={16} color={colors.fg3} strokeWidth={2} />
          <View className="flex-1 gap-0.5">
            <Text className="font-sans-semibold text-small text-fg">Ya cambió de receptor una vez</Text>
            <Text className="font-sans text-caption text-fg-2">
              {requester} te pasó la recepción. No se puede volver a transferir.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (!RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES.includes(shipment.status)) {
    return null;
  }

  return (
    <View testID={testID}>
      {eyebrow}
      <Pressable
        testID={testID ? `${testID}-action` : undefined}
        onPress={() => router.push(`/shipments/${shipment.id}/receiver-transfer`)}
        accessibilityRole="button"
        className="flex-row items-center gap-3 rounded-[14px] border border-border bg-bg px-3.5 py-3.5 active:opacity-80"
      >
        <View className="h-10 w-10 items-center justify-center rounded-full bg-bg-mute">
          <ArrowLeftRight size={18} color={colors.fg2} strokeWidth={1.9} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="font-sans-semibold text-small text-fg">Que lo reciba otra persona</Text>
          <Text className="font-sans text-caption text-fg-2">
            ¿No vas a estar? Elegí a alguien de Movo para que lo reciba en tu lugar.
          </Text>
        </View>
        <ChevronRight size={18} color={colors.fg3} strokeWidth={2} />
      </Pressable>
      <Text className="mt-1.5 font-sans text-caption text-fg-3">
        La dirección de entrega no cambia. Se puede cambiar quién recibe una sola vez.
      </Text>
    </View>
  );
}
