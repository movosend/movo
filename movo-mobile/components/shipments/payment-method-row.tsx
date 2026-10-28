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

const CAPTION: Record<ShipmentPaymentMethod, string> = {
  card: "Reserva en tu tarjeta",
  cash: "En mano al retiro",
};

const CASH_DETAIL: Record<ShipmentPaymentMethodRowProps["role"], string> = {
  sender: "Le pagás el monto acordado completo al transportista cuando le entregás el paquete.",
  carrier: "El emisor te paga cuando te entrega el paquete. La comisión de Movo queda como saldo en tu cuenta al entregar.",
};

/** MOVO-37 (M2): modalidad de pago del envío en el detalle, para el emisor y el transportista. Mismo formato que
 * `PackageCard`, bajo su propio título de sección. */
export function ShipmentPaymentMethodRow({ paymentMethod, role, testID }: ShipmentPaymentMethodRowProps) {
  const colors = useThemeColors();
  const Icon = paymentMethod === "cash" ? Banknote : CreditCard;
  return (
    <View testID={testID} className="overflow-hidden rounded-[14px] border border-border bg-bg">
      <View className="flex-row items-center gap-3 px-4 py-3.5">
        <View className="h-11 w-11 items-center justify-center rounded-[8px] bg-bg-mute">
          <Icon size={22} color={colors.fg2} strokeWidth={1.8} />
        </View>
        <View className="flex-1">
          <Text testID={testID ? `${testID}-label` : undefined} className="font-sans-semibold text-[14px] text-fg">
            {PAYMENT_METHOD_LABEL[paymentMethod]}
          </Text>
          {/* El emisor con tarjeta ve "Reserva en tu tarjeta"; el transportista cobra por MP, no reserva nada. */}
          {paymentMethod === "cash" || role === "sender" ? (
            <Text className="mt-0.5 font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
              {CAPTION[paymentMethod]}
            </Text>
          ) : null}
          {paymentMethod === "cash" ? (
            <Text className="mt-1 font-sans text-small text-fg-2">{CASH_DETAIL[role]}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
