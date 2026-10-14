import { AlertTriangle } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useShipmentSettlement } from "../../src/hooks/use-shipment-settlement";
import {
  formatSettlementAmount,
  resolvePaymentView,
  SETTLEMENT_ESCALATION_RESPONSE_HOURS,
} from "../../src/lib/settlement-format";

/** La captura corre en segundo plano apenas se confirma la entrega: se vuelve a consultar
 * seguido mientras la pantalla de éxito está abierta. */
const SUCCESS_POLL_MS = 4000;

interface DeliveryPaymentStatusProps {
  shipmentId: string;
  /** "Ver detalle" del cobro acreditado: lleva al detalle del envío. */
  onViewDetail?: () => void;
  testID?: string;
}

/**
 * Estado del cobro en la pantalla de éxito del wizard de entrega (MOVO-214 AC5, reemplaza el
 * "El pago se está procesando." provisorio de MOVO-199 AC8). Vive en la hoja blanca de
 * `HandshakeConfirmationResult`, que es clara en los dos temas: colores fijos.
 *
 * Solo el transportista llega acá. Un error de la consulta se muestra como "cobrando": la
 * entrega ya disparó la captura, y nunca se afirma un monto que no llegó.
 */
export function DeliveryPaymentStatus({
  shipmentId,
  onViewDetail,
  testID,
}: DeliveryPaymentStatusProps) {
  const { data } = useShipmentSettlement(shipmentId, {
    enabled: true,
    pollWhileProcessingMs: SUCCESS_POLL_MS,
  });
  const view = resolvePaymentView("carrier", data ?? null, null);

  if (view.kind === "carrier_credited") {
    return (
      <View
        testID={testID ? `${testID}-credited` : undefined}
        className="rounded-[14px] bg-ink-950 p-4"
      >
        <Text className="font-sans-medium text-caption uppercase text-ink-300">
          Te acreditamos
        </Text>
        <Text
          testID={testID ? `${testID}-net` : undefined}
          className="mt-1 font-sans-semibold text-display text-paper"
        >
          {formatSettlementAmount(view.netArs)}
        </Text>
        <View className="mt-2 flex-row items-center justify-between gap-3">
          <Text className="font-sans text-[12.5px] text-ink-300">
            En tu cuenta de Mercado Pago
          </Text>
          {onViewDetail ? (
            <Pressable
              testID={testID ? `${testID}-view-detail` : undefined}
              onPress={onViewDetail}
              accessibilityRole="link"
              hitSlop={8}
            >
              <Text className="font-sans-semibold text-[12.5px] text-paper underline">
                Ver detalle
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const escalated = view.kind === "carrier_escalated";
  return (
    <View
      testID={
        testID
          ? `${testID}-${escalated ? "escalated" : "processing"}`
          : undefined
      }
      className={`flex-row items-center gap-3 rounded-[14px] border p-3.5 ${
        escalated ? "border-warning-200 bg-warning-100" : "border-ink-950/10"
      }`}
    >
      <View
        className={`h-9 w-9 items-center justify-center rounded-full ${escalated ? "bg-warning-200" : "bg-ink-100"}`}
      >
        {escalated ? (
          <AlertTriangle size={16} color="#A97714" strokeWidth={2} />
        ) : (
          <ActivityIndicator size="small" color="#3A3A40" />
        )}
      </View>
      <View className="flex-1">
        <Text className="font-sans-semibold text-[14px] leading-5 text-ink-950">
          {escalated ? "Tu cobro está demorado" : "Estamos cobrando el envío"}
        </Text>
        <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-ink-500">
          {escalated
            ? `Lo estamos revisando. Te escribimos dentro de las próximas ${SETTLEMENT_ESCALATION_RESPONSE_HOURS} horas.`
            : "Te avisamos cuando se acredite en tu cuenta de Mercado Pago."}
        </Text>
      </View>
    </View>
  );
}
