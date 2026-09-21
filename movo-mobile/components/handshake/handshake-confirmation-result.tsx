import { CheckCircle2 } from "lucide-react-native";
import { Text, View } from "react-native";
import type { ConfirmHandshakeResult } from "../../src/api/shipments-client";
import { formatEventTimestamp } from "../../src/lib/shipment-format";

interface HandshakeConfirmationResultProps {
  result: ConfirmHandshakeResult;
  testID?: string;
}

const STAGE_COPY: Record<ConfirmHandshakeResult["stage"], { title: string; body: string }> = {
  pickup: {
    title: "Retiro confirmado",
    body: "Tenés la custodia del paquete. El envío pasó a en tránsito.",
  },
  delivery: {
    title: "Entrega confirmada",
    body: "El envío figura como entregado. El pago se está procesando.",
  },
};

const STATUS_LABEL: Record<ConfirmHandshakeResult["stage"], string> = {
  pickup: "En tránsito",
  delivery: "Entregado",
};

/**
 * Pantalla de éxito del escaneo (MOVO-160, AC4) — puramente presentacional, calcada
 * del paso `wzIsDone` del prototipo "Viaje del transportista". Sin navegación propia:
 * el caller (la ruta standalone hoy, un wizard MOVO-198/199 más adelante) decide qué
 * botón mostrar y a dónde va.
 */
export function HandshakeConfirmationResult({ result, testID }: HandshakeConfirmationResultProps) {
  const copy = STAGE_COPY[result.stage];
  const confirmedAtLabel = formatEventTimestamp(result.confirmedAt);

  return (
    <View testID={testID} className="flex-1 items-center justify-center gap-6 px-6">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-lime-500">
        <CheckCircle2 size={32} color="#0A0A0B" strokeWidth={2.4} />
      </View>

      <View className="items-center gap-2">
        <Text className="text-center font-sans-semibold text-h2 text-fg">{copy.title}</Text>
        <Text className="text-center font-sans text-body text-fg-2">{copy.body}</Text>
      </View>

      <View className="w-full gap-0 rounded-[10px] border border-border px-3.5">
        <View className="flex-row items-center justify-between gap-3.5 border-b border-border py-3">
          <Text className="font-sans text-[12px] text-fg-3">Estado</Text>
          <Text className="font-sans text-[13px] text-fg">
            {STATUS_LABEL[result.stage]}
          </Text>
        </View>
        <View className="flex-row items-center justify-between gap-3.5 border-b border-border py-3">
          <Text className="font-sans text-[12px] text-fg-3">Distancia verificada</Text>
          <Text className="font-sans text-[13px] text-fg">{Math.round(result.distanceM)} m</Text>
        </View>
        <View className="flex-row items-center justify-between gap-3.5 py-3">
          <Text className="font-sans text-[12px] text-fg-3">Hora</Text>
          <Text className="font-sans text-[13px] text-fg">{confirmedAtLabel ?? "—"}</Text>
        </View>
      </View>
    </View>
  );
}
