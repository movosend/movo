import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import { Clock } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useDeadlineExpired } from "../../src/hooks/use-deadline-expired";
import { useCancelReceiverTransfer } from "../../src/hooks/use-receiver-transfers";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { getFirstName } from "../../src/lib/profile-format";
import { redesignationDeadlineLabel } from "../../src/lib/shipment-format";
import { ConfirmActionSheet } from "../ui/confirm-action-sheet";
import { ErrorBanner } from "../ui/error-banner";

const AMBER = "#A97714";

interface ReceiverTransferPendingBannerProps {
  transfer: ReceiverTransferRequest;
  testID?: string;
}

/** Horas que se le dieron a la persona invitada para aceptar (plazo menos creación). */
function inviteWindowHours(transfer: ReceiverTransferRequest): number | null {
  const hours = Math.round(
    (new Date(transfer.newReceiverDeadline).getTime() - new Date(transfer.createdAt).getTime()) / 3_600_000,
  );
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

/**
 * MOVO-275 AC8: aviso arriba del detalle, sobre el mapa, mientras el receptor vigente espera
 * que la persona que invitó acepte. Es un aviso de estado, no una sección de acciones: lleva el
 * plazo y "Cancelar solicitud" (con confirmación en una sheet). Colores fijos de la familia
 * `warning`, igual que el resto de los avisos de "esperando algo".
 */
export function ReceiverTransferPendingBanner({ transfer, testID }: ReceiverTransferPendingBannerProps) {
  const cancel = useCancelReceiverTransfer();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cancelSheetVisible, setCancelSheetVisible] = useState(false);
  useDeadlineExpired(transfer.newReceiverDeadline);

  const invitedName = transfer.newReceiverName ?? "";
  const invited = getFirstName(invitedName) || "la persona que elegiste";
  const deadline = redesignationDeadlineLabel(transfer.newReceiverDeadline);
  const hours = inviteWindowHours(transfer);

  const handleConfirmCancel = async () => {
    setErrorMessage(null);
    try {
      await cancel.mutateAsync({ transferId: transfer.id });
    } catch (err) {
      setErrorMessage(friendlyErrorMessage(err, "No pudimos cancelar la solicitud. Intentá de nuevo."));
    } finally {
      setCancelSheetVisible(false);
    }
  };

  return (
    <View
      testID={testID}
      className="gap-3 rounded-[14px] border border-warning-300 bg-warning-100 px-4 py-4"
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      <View className="gap-1">
        <Text testID={testID ? `${testID}-title` : undefined} className="font-sans-semibold text-body" style={{ color: AMBER }}>
          Esperando que {invited} acepte
        </Text>
        <Text className="font-sans text-small leading-5 text-ink-950">
          {deadline
            ? `${hours ? `Tiene ${hours} h para aceptar.` : "Todavía puede aceptar."} Si no acepta, el paquete lo seguís recibiendo vos.`
            : "Venció el plazo para aceptar. Lo seguís recibiendo vos."}
        </Text>
      </View>

      <ErrorBanner message={errorMessage} />

      {deadline ? (
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-row items-center gap-1.5">
            <Clock size={15} color={AMBER} strokeWidth={2} />
            <Text testID={testID ? `${testID}-deadline` : undefined} className="font-sans text-small" style={{ color: AMBER }}>
              {deadline.replace(/^Tenés hasta/, "Vence")}
            </Text>
          </View>
          <Pressable
            testID={testID ? `${testID}-cancel` : undefined}
            onPress={() => setCancelSheetVisible(true)}
            disabled={cancel.isPending}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text className="font-sans-semibold text-small text-ink-950 underline">Cancelar solicitud</Text>
          </Pressable>
        </View>
      ) : null}

      <ConfirmActionSheet
        visible={cancelSheetVisible}
        title="¿Cancelar la solicitud?"
        description={`${invited} ya no va a poder aceptar. El paquete lo seguís recibiendo vos.`}
        confirmLabel="Cancelar solicitud"
        tone="danger"
        isPending={cancel.isPending}
        onConfirm={() => void handleConfirmCancel()}
        onClose={() => setCancelSheetVisible(false)}
        testID={testID ? `${testID}-cancel-sheet` : "receiver-transfer-cancel-sheet"}
      />
    </View>
  );
}
