import { router } from "expo-router";
import { Clock, UserRoundPlus, XCircle } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useDeadlineExpired } from "../../src/hooks/use-deadline-expired";
import { redesignationDeadlineLabel } from "../../src/lib/shipment-format";

interface RejectedReceiverBannerProps {
  shipment: Pick<ShipmentSummary, "id" | "rejectionReason" | "receiverRedesignationDeadline">;
  testID?: string;
}

/**
 * MOVO-253 AC6: vista emisor de un envío `rejected_by_receiver` — motivo del rechazo,
 * hasta cuándo puede elegir a otra persona y el CTA. `useDeadlineExpired` re-renderiza
 * al vencer el plazo, así el CTA desaparece con la pantalla abierta aunque el barrido
 * todavía no haya cancelado el envío (mismo criterio que la confirmación del receptor,
 * MOVO-130 AC5). Un plazo nulo es un rechazo anterior a MOVO-253: se muestra como
 * vencido, igual que lo trata el backend. Colores fijos (`ink-950`/blanco sobre el
 * pastel `warning-100`), mismo criterio que `ErrorBanner`: el fondo no cambia con el tema.
 */
export function RejectedReceiverBanner({ shipment, testID }: RejectedReceiverBannerProps) {
  useDeadlineExpired(shipment.receiverRedesignationDeadline);
  const deadlineLabel = redesignationDeadlineLabel(shipment.receiverRedesignationDeadline);

  return (
    <View testID={testID} className="gap-3 rounded-xl border border-warning-300 bg-warning-100 px-3.5 py-3.5">
      <View className="flex-row items-center gap-2">
        <XCircle size={16} color="#A97714" strokeWidth={2} />
        <Text className="flex-1 font-sans-semibold text-small text-ink-950">
          El receptor rechazó el envío
        </Text>
      </View>

      {shipment.rejectionReason ? (
        <Text testID={testID ? `${testID}-reason` : undefined} className="font-sans text-small text-ink-950">
          “{shipment.rejectionReason}”
        </Text>
      ) : null}

      {deadlineLabel ? (
        <>
          <View className="flex-row items-center gap-1.5">
            <Clock size={13} color="#A97714" strokeWidth={2} />
            <Text testID={testID ? `${testID}-deadline` : undefined} className="font-sans text-caption text-ink-950">
              {deadlineLabel} para elegir a otra persona. Si no, el envío se cancela.
            </Text>
          </View>
          <Pressable
            testID={testID ? `${testID}-cta` : undefined}
            onPress={() => router.push(`/shipments/${shipment.id}/change-receiver`)}
            className="h-10 flex-row items-center justify-center gap-2 rounded-full bg-ink-950"
          >
            <UserRoundPlus size={15} color="#FFFFFF" strokeWidth={2} />
            <Text className="font-sans-semibold text-caption text-paper">Elegir otro receptor</Text>
          </Pressable>
        </>
      ) : (
        <Text testID={testID ? `${testID}-expired` : undefined} className="font-sans text-caption text-ink-950">
          Venció el plazo para elegir otro receptor. El envío se va a cancelar.
        </Text>
      )}
    </View>
  );
}
