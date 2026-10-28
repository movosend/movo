import { Banknote, CreditCard } from "lucide-react-native";
import { Text, View } from "react-native";
import type { ShipmentPaymentMethod } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { PAYMENT_METHOD_LABEL } from "../../src/lib/payment-method";

export interface ShipmentPaymentMethodRowProps {
  paymentMethod: ShipmentPaymentMethod;
  role: "sender" | "carrier";
  testID?: string;
}

const CASH_DETAIL: Record<ShipmentPaymentMethodRowProps["role"], string> = {
  sender: "Le pagás el monto acordado completo al transportista, en mano, cuando le entregás el paquete.",
  carrier:
    "El emisor te paga en mano cuando te entrega el paquete. La comisión de Movo queda como saldo en tu cuenta al entregar.",
};

/** MOVO-37 (M2): modalidad de pago del envío en el detalle, para el emisor y el transportista. */
export function ShipmentPaymentMethodRow({ paymentMethod, role, testID }: ShipmentPaymentMethodRowProps) {
  const colors = useThemeColors();
  const Icon = paymentMethod === "cash" ? Banknote : CreditCard;
  return (
    <View testID={testID} className="flex-row gap-3 rounded-[10px] border border-border px-3.5 py-3">
      <Icon size={18} strokeWidth={1.8} color={colors.fg2} style={{ marginTop: 1 }} />
      <View className="flex-1 gap-0.5">
        <Text className="font-sans text-[11px] text-fg-3">Pago</Text>
        <Text testID={testID ? `${testID}-label` : undefined} className="font-sans-semibold text-[14px] text-fg">
          {PAYMENT_METHOD_LABEL[paymentMethod]}
        </Text>
        {paymentMethod === "cash" ? (
          <Text className="font-sans text-[12.5px] leading-[18px] text-fg-2">{CASH_DETAIL[role]}</Text>
        ) : null}
      </View>
    </View>
  );
}
