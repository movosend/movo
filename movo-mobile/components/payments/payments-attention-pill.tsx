import { Text, View } from "react-native";
import type { PaymentsAttention } from "../../src/lib/payments-attention";
import { formatPriceArs } from "../../src/lib/shipment-format";

const PILLS: Record<PaymentsAttention, { label: string; bg: string; text: string }> = {
  mp_invalid: { label: "Revisar", bg: "bg-danger-100", text: "text-danger-700" },
  debt: { label: "Saldo pendiente", bg: "bg-danger-100", text: "text-danger-700" },
  cards_expired: { label: "Vencidas", bg: "bg-warning-100", text: "text-warning-700" },
};

/**
 * Aviso de la fila "Pagos y cobros" de Perfil → Configuración: solo aparece cuando hay algo
 * que resolver (ver `paymentsAttention`). Colores de estado fijos en los dos temas, mismo
 * criterio que el resto de la app.
 */
export function PaymentsAttentionPill({ attention, balanceArs, testID }: { attention: PaymentsAttention; balanceArs?: number; testID?: string }) {
  const pill = PILLS[attention];
  // Con el monto la deuda se entiende sin abrir la pantalla.
  const label = attention === "debt" && balanceArs ? `Debés ${formatPriceArs(balanceArs)}` : pill.label;
  return (
    <View testID={testID} className={`rounded-full px-[9px] py-[3px] ${pill.bg}`}>
      <Text className={`font-sans-medium text-[11px] ${pill.text}`}>{label}</Text>
    </View>
  );
}
