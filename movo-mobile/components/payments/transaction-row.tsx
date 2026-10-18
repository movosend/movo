import type { TransactionListItem, TransactionRole } from "@movo/shared/dist/types/transaction";
import { ArrowDownLeft, ArrowUpRight, CreditCard, Undo2 } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  debtLine,
  formatTransactionAmount,
  refundLine,
  transactionTitle,
  transactionRowSubtitle,
  transactionStatusLabel,
} from "../../src/lib/transaction-format";
import { TransactionStatusPill } from "./transaction-status-pill";

/**
 * Fila del historial (MOVO-304 AC4): referencia `#MOVO-xxxxx` (o "Pago de tu saldo"), tarjeta (solo Pagos), fecha,
 * monto y pill de estado. Una transacción con reembolso suma "Reembolso de $X". En Cobros un
 * cobro que todavía no se acreditó (reservado, liberado, en disputa) lleva el monto atenuado,
 * como el canvas.
 */
export function TransactionRow({
  item,
  role,
  onPress,
}: {
  item: TransactionListItem;
  role: TransactionRole;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const title = transactionTitle(item);
  const refund = refundLine(item);
  const debt = debtLine(item, role);
  const muted = role === "carrier" && item.status !== "completed" && item.status !== "refunded";
  const Direction = role === "sender" ? ArrowUpRight : ArrowDownLeft;
  const amount = formatTransactionAmount(item.amountArs);

  return (
    <Pressable
      testID={`transaction-row-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${role === "sender" ? "Pago" : "Cobro"} · ${title}, ${amount}, ${transactionStatusLabel(item.status, role)}`}
      accessibilityHint="Abre el detalle"
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-border px-5 py-3 active:bg-bg-sub"
    >
      <View
        className={`h-10 w-10 items-center justify-center rounded-full border border-border-strong ${muted ? "bg-bg-sub" : "bg-bg"}`}
      >
        <CreditCard size={20} color={colors.fg1} strokeWidth={2} />
        <View
          accessibilityLabel={role === "sender" ? "Pago saliente" : "Cobro entrante"}
          className="absolute -bottom-1 -right-1 h-5 w-5 items-center justify-center rounded-full border-2 border-bg bg-bg-mute"
        >
          <Direction size={10} color={colors.fg1} strokeWidth={3} />
        </View>
      </View>

      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className="font-sans-semibold text-[15px] leading-5 text-fg">
          {title}
        </Text>
        <Text numberOfLines={1} className="font-sans text-[12.5px] leading-4 text-fg-2">
          {transactionRowSubtitle(item, role)}
        </Text>
        {debt ? (
          <Text testID={`transaction-debt-${item.id}`} numberOfLines={1} className="font-sans-medium text-[12.5px] leading-4 text-fg">
            {debt}
          </Text>
        ) : null}
        {refund ? (
          <View testID={`transaction-refund-${item.id}`} className="flex-row items-center gap-1">
            <Undo2 size={12} color={colors.fg1} strokeWidth={2.4} />
            <Text numberOfLines={1} className="font-sans text-[12.5px] leading-4 text-fg">
              {refund}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="items-end gap-1">
        <Text
          className={`text-[14px] ${muted ? "font-sans-medium text-fg-3" : "font-sans-semibold text-fg"}`}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {amount}
        </Text>
        <TransactionStatusPill status={item.status} role={role} testID={`transaction-pill-${item.id}`} />
      </View>
    </Pressable>
  );
}
