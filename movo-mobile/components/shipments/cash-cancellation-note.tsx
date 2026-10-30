import { cashPenaltyCompensationArs } from "@movo/shared/dist/config/commission";
import { Banknote } from "lucide-react-native";
import { Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatPriceArs } from "../../src/lib/shipment-format";

interface CashCancellationNoteProps {
  role: "sender" | "carrier";
  shipment: Pick<ShipmentSummary, "agreedPriceArs" | "cancellationPenaltyArs" | "cancellationPenaltyStatus">;
  testID?: string;
}

/**
 * MOVO-37: un envío en efectivo cancelado tarde no tiene reserva ni liquidación que mostrar, pero el backend sí
 * registra la penalidad como saldo del emisor y la compensación como crédito del transportista
 * (`cashPenaltyCompensationArs`, el mismo cálculo). Sin penalidad (cancelación sin cargo) no se dibuja nada.
 */
export function CashCancellationNote({ role, shipment, testID }: CashCancellationNoteProps) {
  const colors = useThemeColors();
  const penaltyArs = shipment.cancellationPenaltyArs ?? 0;
  if (penaltyArs <= 0) return null;

  let message: string;
  if (role === "sender") {
    message = `Cancelaste con menos de 12 h de anticipación: sumamos ${formatPriceArs(penaltyArs)} a tu saldo con Movo.`;
  } else {
    // Con una penalidad chica la compensación da 0: el transportista no recibe nada, así que no hay nota.
    const compensationArs =
      shipment.agreedPriceArs != null ? cashPenaltyCompensationArs(shipment.agreedPriceArs, penaltyArs) : 0;
    if (compensationArs <= 0) return null;
    message = `El emisor canceló a último momento: te acreditamos ${formatPriceArs(compensationArs)} en tu cuenta de Movo.`;
  }

  return (
    <View testID={testID} className="flex-row items-start gap-2.5 rounded-[10px] bg-bg-mute px-3.5 py-3">
      <Banknote size={16} color={colors.fg2} strokeWidth={2} style={{ marginTop: 1 }} />
      <Text className="flex-1 font-sans text-[12.5px] leading-[18px] text-fg-2">{message}</Text>
    </View>
  );
}
