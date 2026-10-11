import { RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES } from "@movo/shared/dist/types/receiver-transfer";
import { router } from "expo-router";
import { ArrowLeftRight, ChevronRight, Clock, Lock } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useDeadlineExpired } from "../../src/hooks/use-deadline-expired";
import { useCancelReceiverTransfer } from "../../src/hooks/use-receiver-transfers";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { getFirstName } from "../../src/lib/profile-format";
import { redesignationDeadlineLabel } from "../../src/lib/shipment-format";
import { ConfirmActionSheet } from "../ui/confirm-action-sheet";
import { ErrorBanner } from "../ui/error-banner";

interface ReceiverTransferSectionProps {
  shipment: Pick<ShipmentSummary, "id" | "status" | "receiverTransfer">;
  currentUserId: string;
  testID?: string;
}

/**
 * MOVO-275 AC8: sección "Recepción" del detalle, solo para el receptor vigente. Según
 * el estado de la transferencia muestra la acción "Que lo reciba otra persona", la
 * solicitud pendiente con su plazo y "Cancelar solicitud", o que ya no se puede volver
 * a transferir.
 */
export function ReceiverTransferSection({ shipment, currentUserId, testID }: ReceiverTransferSectionProps) {
  const colors = useThemeColors();
  const cancel = useCancelReceiverTransfer();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cancelSheetVisible, setCancelSheetVisible] = useState(false);
  const pending = shipment.receiverTransfer?.pending ?? null;
  const completed = shipment.receiverTransfer?.completed ?? null;
  useDeadlineExpired(pending?.newReceiverDeadline);

  const eyebrow = (
    <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">Recepción</Text>
  );

  if (pending && pending.requestedBy === currentUserId) {
    const invited = getFirstName(pending.newReceiverName) || "la persona que elegiste";
    const deadline = redesignationDeadlineLabel(pending.newReceiverDeadline);
    const handleConfirmCancel = async () => {
      setErrorMessage(null);
      try {
        await cancel.mutateAsync({ transferId: pending.id });
      } catch (err) {
        setErrorMessage(friendlyErrorMessage(err, "No pudimos cancelar la solicitud. Intentá de nuevo."));
      } finally {
        setCancelSheetVisible(false);
      }
    };
    return (
      <View testID={testID}>
        {eyebrow}
        <View
          testID={testID ? `${testID}-pending` : undefined}
          className="gap-3 rounded-xl border border-warning-300 bg-warning-100 px-3.5 py-3.5"
        >
          <View className="flex-row items-center gap-2">
            <ArrowLeftRight size={16} color="#A97714" strokeWidth={2} />
            <Text className="flex-1 font-sans-semibold text-small text-ink-950">Esperando que {invited} acepte</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Clock size={13} color="#A97714" strokeWidth={2} />
            <Text testID={testID ? `${testID}-deadline` : undefined} className="flex-1 font-sans text-caption text-ink-950">
              {deadline
                ? `${deadline.replace(/^Tenés/, "Tiene")} para aceptar. Si no acepta, lo seguís recibiendo vos.`
                : "Venció el plazo para aceptar. Lo seguís recibiendo vos."}
            </Text>
          </View>
          <ErrorBanner message={errorMessage} />
          {deadline ? (
            <Pressable
              testID={testID ? `${testID}-cancel` : undefined}
              onPress={() => setCancelSheetVisible(true)}
              disabled={cancel.isPending}
              accessibilityRole="button"
              className="h-10 flex-row items-center justify-center gap-2 rounded-full border border-ink-950"
            >
              {cancel.isPending ? <ActivityIndicator color="#0A0A0B" /> : null}
              <Text className="font-sans-semibold text-caption text-ink-950">Cancelar solicitud</Text>
            </Pressable>
          ) : null}
        </View>
        <ConfirmActionSheet
          visible={cancelSheetVisible}
          title="¿Cancelar la solicitud?"
          description={`${invited} ya no va a poder aceptar. El paquete lo seguís recibiendo vos.`}
          confirmLabel="Cancelar solicitud"
          cancelLabel="Volver"
          tone="danger"
          isPending={cancel.isPending}
          onConfirm={() => void handleConfirmCancel()}
          onClose={() => setCancelSheetVisible(false)}
          testID={testID ? `${testID}-cancel-sheet` : "receiver-transfer-cancel-sheet"}
        />
      </View>
    );
  }

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
