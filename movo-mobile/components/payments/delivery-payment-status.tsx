import { AlertTriangle, Clock } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useShipmentSettlement } from "../../src/hooks/use-shipment-settlement";
import {
  formatSettlementAmount,
  resolvePaymentView,
} from "../../src/lib/settlement-format";

/** La captura corre en segundo plano apenas se confirma la entrega: se vuelve a consultar
 * seguido mientras la pantalla de éxito está abierta. */
const SUCCESS_POLL_MS = 4000;

interface DeliveryPaymentStatusProps {
  shipmentId: string;
  /** "Ver detalle" del cobro: lleva al detalle del envío. */
  onViewDetail?: () => void;
  testID?: string;
}

/**
 * Estado del cobro en la pantalla de éxito del wizard de entrega (MOVO-214 AC5, reemplaza el
 * "El pago se está procesando." provisorio de MOVO-199 AC8). Vive en la hoja blanca de
 * `HandshakeConfirmationResult`, que es clara en los dos temas: colores fijos.
 *
 * Solo el transportista llega acá. Si la consulta falla o se agota el tiempo de polling,
 * se invita a ver el detalle del envío para seguir el cobro.
 */
export function DeliveryPaymentStatus({
  shipmentId,
  onViewDetail,
  testID,
}: DeliveryPaymentStatusProps) {
  const { data, isError, isPollingTimedOut } = useShipmentSettlement(
    shipmentId,
    {
      enabled: true,
      pollWhileProcessingMs: SUCCESS_POLL_MS,
    },
  );
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

  if (view.kind === "carrier_escalated") {
    return (
      <View
        testID={testID ? `${testID}-escalated` : undefined}
        className="flex-row items-center gap-3 rounded-[14px] border border-warning-200 bg-warning-100 p-3.5"
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-warning-200">
          <AlertTriangle size={16} color="#A97714" strokeWidth={2} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[14px] leading-5 text-ink-950">
            Tu cobro está demorado
          </Text>
          <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-ink-500">
            Lo estamos revisando. Te escribimos a la brevedad.
          </Text>
        </View>
      </View>
    );
  }

  const failedOrTimedOut = isError || isPollingTimedOut;
  if (failedOrTimedOut) {
    return (
      <View
        testID={testID ? `${testID}-error` : undefined}
        className="flex-row items-center justify-between gap-3 rounded-[14px] border border-ink-950/10 p-3.5"
      >
        <View className="flex-1 flex-row items-center gap-3">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-100">
            <Clock size={16} color="#3A3A40" strokeWidth={2} />
          </View>
          <View className="flex-1">
            <Text className="font-sans-semibold text-[14px] leading-5 text-ink-950">
              Mirá el detalle del envío
            </Text>
            <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-ink-500">
              Seguí el estado del cobro desde ahí.
            </Text>
          </View>
        </View>
        {onViewDetail ? (
          <Pressable
            testID={testID ? `${testID}-view-detail` : undefined}
            onPress={onViewDetail}
            accessibilityRole="link"
            hitSlop={8}
          >
            <Text className="font-sans-semibold text-[12.5px] text-ink-950 underline">
              Ver detalle
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      testID={testID ? `${testID}-processing` : undefined}
      className="flex-row items-center gap-3 rounded-[14px] border border-ink-950/10 p-3.5"
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-100">
        <ActivityIndicator size="small" color="#3A3A40" />
      </View>
      <View className="flex-1">
        <Text className="font-sans-semibold text-[14px] leading-5 text-ink-950">
          Estamos cobrando el envío
        </Text>
        <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-ink-500">
          Te avisamos cuando se acredite en tu cuenta de Mercado Pago.
        </Text>
      </View>
    </View>
  );
}
