import { Inbox } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { AttentionConfirmTask } from "../../src/hooks/use-attention-tasks";
import { useAcceptShipment, useRejectShipment } from "../../src/hooks/use-shipments";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  ShipmentConfirmationSheets,
  type ShipmentConfirmationSheetsHandle,
} from "../shipments/shipment-confirmation-sheets";
import { ErrorBanner } from "../ui/error-banner";

/**
 * Card de la tarea de confirmación en "Requiere tu atención" (MOVO-193, feedback del
 * usuario: aceptar/rechazar debe usar el mismo sheet diseñado para esa función en el
 * detalle del envío, no un `Alert` genérico). Tocar la card fuera de los botones
 * navega al detalle (`task.onPress`); los botones abren
 * `ShipmentConfirmationSheets` — el mismo componente que dispara `ReceiverActionsBar`
 * (MOVO-131/154) — vía `ref`, sin duplicar el sheet ni sus mutaciones.
 *
 * `onAcceptSuccess` viaja hasta `AttentionTaskList` (bug de review, fix post-merge):
 * aceptar invalida `["shipments","mine"]`, lo que hace que esta card deje de listarse
 * en cuanto vuelve el refetch — sin levantar el modal de éxito a un padre que
 * sobreviva a ese desmonte (mismo criterio que `AcceptSuccessModal` en
 * `shipments/[id].tsx`), la pantalla "Envío aceptado" se cerraba sola apenas
 * terminaba el refetch en background, antes de que el usuario la cerrara a mano.
 */
export function AttentionConfirmCard({
  task,
  onAcceptSuccess,
  testID,
}: {
  task: AttentionConfirmTask;
  onAcceptSuccess?: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const acceptMutation = useAcceptShipment();
  const rejectMutation = useRejectShipment();
  const sheetsRef = useRef<ShipmentConfirmationSheetsHandle>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isBusy = acceptMutation.isPending || rejectMutation.isPending;

  const handleReject = () => {
    if (isBusy) return;
    setErrorMessage(null);
    sheetsRef.current?.openReject();
  };

  const handleAccept = () => {
    if (isBusy) return;
    setErrorMessage(null);
    sheetsRef.current?.openAccept();
  };

  return (
    <View className="gap-3 rounded-[16px] border border-border bg-bg p-4">
      <Pressable testID={testID} onPress={task.onPress} className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-bg-mute">
          <Inbox size={20} color={colors.fg2} strokeWidth={1.8} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={2} className="font-sans-semibold text-small text-fg">
            {task.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-caption text-fg-2">
            {task.meta}
          </Text>
        </View>
      </Pressable>

      {errorMessage ? (
        <ErrorBanner testID={testID ? `${testID}-error` : undefined} message={errorMessage} />
      ) : null}

      <View className="flex-row gap-2.5">
        <Pressable
          testID={testID ? `${testID}-secondary` : undefined}
          onPress={handleReject}
          disabled={isBusy}
          className={`h-10 flex-1 items-center justify-center rounded-full border border-border ${
            isBusy ? "opacity-50" : ""
          }`}
        >
          <Text className="font-sans-semibold text-small text-fg">Rechazar</Text>
        </Pressable>
        <Pressable
          testID={testID ? `${testID}-primary` : undefined}
          onPress={handleAccept}
          disabled={isBusy}
          className={`h-10 flex-1 items-center justify-center rounded-full ${
            isBusy ? "bg-bg-mute" : "bg-ink-950"
          }`}
        >
          <Text className={`font-sans-semibold text-small ${isBusy ? "text-fg-3" : "text-paper"}`}>
            Aceptar
          </Text>
        </Pressable>
      </View>

      <ShipmentConfirmationSheets
        ref={sheetsRef}
        shipmentId={task.shipmentId}
        senderFirstName={task.senderFirstName}
        acceptMutation={acceptMutation}
        rejectMutation={rejectMutation}
        onAcceptSuccess={onAcceptSuccess}
        onError={setErrorMessage}
        testID={testID}
      />
    </View>
  );
}
