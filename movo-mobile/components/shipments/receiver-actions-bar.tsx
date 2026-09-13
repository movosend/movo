import * as Haptics from "expo-haptics";
import { ArrowRight, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  useAcceptShipment,
  useRejectShipment,
} from "../../src/hooks/use-shipments";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  formatReceiverConfirmationDeadline,
  receiverConfirmationRemainingFraction,
} from "../../src/lib/shipment-format";
import { ErrorBanner } from "../ui/error-banner";
import {
  ShipmentConfirmationSheets,
  type ShipmentConfirmationSheetsHandle,
} from "./shipment-confirmation-sheets";

export interface ReceiverActionsBarProps {
  shipmentId: string;
  receiverConfirmationDeadline?: string | null;
  shipmentCreatedAt?: string | null;
  senderFirstName?: string;
  onRefetch?: () => void;
  onAcceptSuccess?: () => void;
  testID?: string;
}

/**
 * Barra de acciones del receptor (MOVO-131, AC4/AC6/AC9; rediseñada en MOVO-154 con
 * referencia visual explícita del usuario — botón "X" + "Aceptar envío" en vez del
 * slider anterior, que se descartó por no gustar):
 * Fija al pie del detalle de envío cuando el usuario autenticado es el receptor
 * y el envío está en `awaiting_receiver_confirmation`.
 *
 * - Botón cuadrado con ícono "X" (rechazar) + botón "Aceptar envío" con flecha,
 *   mismo par de acciones que la referencia — sin el peso visual invertido de antes
 *   (rechazar ya no es un link de texto secundario, es un botón real del mismo alto).
 * - Los sheets de confirmación (aceptar/rechazar con motivos) viven en
 *   `ShipmentConfirmationSheets` (extraído en MOVO-193 para reusarlos también desde
 *   la card de "Requiere tu atención" de Inicio) — esta barra solo dispara
 *   `openAccept`/`openReject` vía `ref` y muestra el `ErrorBanner`/deadline propios.
 * - Muestra tiempo restante para confirmar + barra de progreso (fracción de la
 *   ventana total que queda, `receiverConfirmationRemainingFraction`) si
 *   `receiverConfirmationDeadline`/`shipmentCreatedAt` están presentes.
 * - Deshabilita ambos botones durante mutación en vuelo para prevenir double tap.
 * - Maneja errores 409/403/genérico con mensajes específicos.
 */
export function ReceiverActionsBar({
  shipmentId,
  receiverConfirmationDeadline,
  shipmentCreatedAt,
  senderFirstName,
  onRefetch,
  onAcceptSuccess,
  testID,
}: ReceiverActionsBarProps) {
  const colors = useThemeColors();
  const acceptMutation = useAcceptShipment();
  const rejectMutation = useRejectShipment();
  const sheetsRef = useRef<ShipmentConfirmationSheetsHandle>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deadlineLabel = formatReceiverConfirmationDeadline(receiverConfirmationDeadline);
  const remainingFraction = receiverConfirmationRemainingFraction(
    shipmentCreatedAt,
    receiverConfirmationDeadline,
  );
  const isBusy = acceptMutation.isPending || rejectMutation.isPending;

  const handleAcceptPress = () => {
    if (isBusy) return;
    setErrorMessage(null);
    sheetsRef.current?.openAccept();
  };

  const handleRejectPress = () => {
    if (isBusy) return;
    setErrorMessage(null);
    sheetsRef.current?.openReject();
  };

  return (
    <View
      testID={testID}
      className="border-t border-border bg-bg px-5 pb-5 pt-3.5"
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: -4 },
        elevation: 8,
      }}
    >
      {errorMessage ? (
        <View className="mb-3">
          <ErrorBanner
            testID={testID ? `${testID}-error` : "receiver-actions-error"}
            message={errorMessage}
          />
        </View>
      ) : null}

      {deadlineLabel ? (
        <View
          testID={testID ? `${testID}-deadline` : "receiver-actions-deadline"}
          className="mb-3"
        >
          <Text className="mb-2 text-center font-sans text-small text-fg-2">
            {deadlineLabel.split(/(\d+ h)/).map((part, index) =>
              /^\d+ h$/.test(part) ? (
                <Text key={index} className="font-sans-semibold text-fg">
                  {part}
                </Text>
              ) : (
                part
              ),
            )}
          </Text>
          {remainingFraction !== null ? (
            <View className="h-1 overflow-hidden rounded-full bg-bg-mute">
              <View
                testID={testID ? `${testID}-deadline-progress` : undefined}
                className="h-1 rounded-full bg-lime-500"
                style={{ width: `${remainingFraction * 100}%` }}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <View className="flex-row gap-3">
        <Pressable
          testID={
            testID
              ? `${testID}-reject-button`
              : "receiver-actions-reject-button"
          }
          onPress={handleRejectPress}
          disabled={isBusy}
          accessibilityLabel="Rechazar este envío"
          className={`h-14 w-14 items-center justify-center rounded-lg border border-border ${
            isBusy ? "opacity-50" : "bg-bg"
          }`}
        >
          <X size={22} color={colors.fg1} strokeWidth={2} />
        </Pressable>

        <Pressable
          testID={
            testID
              ? `${testID}-accept-button`
              : "receiver-actions-accept-button"
          }
          onPress={handleAcceptPress}
          disabled={isBusy}
          className={`h-14 flex-1 flex-row items-center justify-center gap-2 rounded-lg ${
            isBusy ? "bg-bg-mute" : "bg-lime-500"
          }`}
        >
          <Text
            className={`font-sans-semibold text-body ${
              isBusy ? "text-fg-3" : "text-ink-950"
            }`}
          >
            Aceptar envío
          </Text>
          <ArrowRight size={18} color={isBusy ? colors.fg3 : "#0A0A0B"} strokeWidth={2.2} />
        </Pressable>
      </View>

      <ShipmentConfirmationSheets
        ref={sheetsRef}
        shipmentId={shipmentId}
        senderFirstName={senderFirstName}
        acceptMutation={acceptMutation}
        rejectMutation={rejectMutation}
        onRefetch={onRefetch}
        onAcceptSuccess={onAcceptSuccess}
        onError={setErrorMessage}
        testID={testID}
      />
    </View>
  );
}
