import { Banknote } from "lucide-react-native";
import { Text, View } from "react-native";
import type { ShipmentPaymentMethod } from "../../src/api/shipments-client";

export interface PaymentMethodBadgeProps {
  paymentMethod?: ShipmentPaymentMethod;
  /** `pill`: fila de chips del feed (mayúsculas, redondeado). `tag`: cards y detalles, como "Urgente". */
  variant?: "pill" | "tag";
  testID?: string;
}

/**
 * MOVO-37: "Efectivo" en un envío que el emisor paga en mano al retiro, para que el transportista lo vea antes de
 * ofertar. Con tarjeta (o sin el campo) no se dibuja: es el caso por defecto.
 */
export function PaymentMethodBadge({ paymentMethod, variant = "tag", testID }: PaymentMethodBadgeProps) {
  if (paymentMethod !== "cash") return null;
  if (variant === "pill") {
    return (
      <View testID={testID} className="rounded-full bg-success-100 px-2.5 py-1">
        <Text className="font-sans-semibold text-[10px] uppercase tracking-wide text-success-700">Efectivo</Text>
      </View>
    );
  }
  return (
    <View testID={testID} className="flex-row items-center gap-1 self-start rounded-md bg-success-100 px-2 py-0.5">
      <Banknote size={12} strokeWidth={2} color="#16754A" />
      <Text className="font-sans-medium text-[11px] text-success-700">Efectivo</Text>
    </View>
  );
}
