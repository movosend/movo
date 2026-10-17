import { Info } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatPriceArs } from "../../src/lib/shipment-format";

/** Desglose de la vista previa del cobro; el descuento siempre viene del backend. */
export function DebtDiscount({ beforeArs, amountArs, dark = false }: { beforeArs: number; amountArs: number | null | undefined; dark?: boolean }) {
  const colors = useThemeColors();
  if (!amountArs || amountArs <= 0) return null;
  return (
    <View testID="debt-discount" className={`gap-1.5 rounded-lg border p-3 ${dark ? "border-white/10 bg-white/[0.06]" : "border-border bg-bg"}`}>
      <View className="flex-row justify-between gap-3"><Text className={`font-sans text-[12px] ${dark ? "text-ink-300" : "text-fg-2"}`}>Recibís aprox. antes</Text><Text className={`font-sans text-[12px] line-through ${dark ? "text-ink-400" : "text-fg-3"}`}>{formatPriceArs(beforeArs)}</Text></View>
      <View className="flex-row justify-between gap-3"><Text className={`font-sans text-[12px] ${dark ? "text-ink-300" : "text-fg-2"}`}>Descuento por saldo pendiente</Text><Text className="font-sans-semibold text-[12px] text-danger-600">−{formatPriceArs(amountArs)}</Text></View>
      <View className="flex-row items-start gap-1.5 border-t border-border pt-1.5">
        <Info size={14} color={dark ? "#D5D5DB" : colors.fg3} strokeWidth={1.8} />
        <Text className={`min-w-0 flex-1 font-sans text-[11px] ${dark ? "text-ink-300" : "text-fg-3"}`}>Se descuenta de tu deuda con Movo al cobrar este envío.</Text>
      </View>
    </View>
  );
}
