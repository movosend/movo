import type { TransactionRole, TransactionStatus } from "@movo/shared/dist/types/transaction";
import { Text, View } from "react-native";
import { TRANSACTION_PILL_CLASSES, transactionStatusLabel } from "../../src/lib/transaction-format";

/**
 * Pill de estado de una transacción (MOVO-304 AC6). Colores y etiquetas salen de
 * `transaction-format.ts`, la única fuente: la lista, el detalle y los filtros no los repiten.
 */
export function TransactionStatusPill({
  status,
  role,
  label,
  size = "sm",
  testID,
}: {
  status: TransactionStatus;
  role: TransactionRole;
  /** Reemplaza la etiqueta (ej. "Reembolsado parcialmente" en el detalle). */
  label?: string;
  size?: "sm" | "md";
  testID?: string;
}) {
  const classes = TRANSACTION_PILL_CLASSES[status];
  return (
    <View
      testID={testID}
      className={`self-start rounded-full ${size === "md" ? "px-2.5 py-1" : "px-2 py-[3px]"} ${classes.container}`}
    >
      <Text
        className={`font-sans-semibold ${size === "md" ? "text-[12px]" : "text-[11.5px]"} ${classes.text}`}
        numberOfLines={1}
      >
        {label ?? transactionStatusLabel(status, role)}
      </Text>
    </View>
  );
}
