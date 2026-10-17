import type { UserLedgerEntry } from "@movo/shared/dist/types/user-ledger";
import { router } from "expo-router";
import { Check, ChevronRight, Receipt } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useBalance } from "../../src/hooks/use-balance";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { balanceEntryAmount, balanceEntryLabel, balanceEntryOrigin, balanceEntryRole } from "../../src/lib/balance-format";
import { formatPriceArs } from "../../src/lib/shipment-format";
import { BalancePaySheet } from "./balance-pay-sheet";
import { useSavedCards } from "../../src/hooks/use-saved-cards";

const MOVEMENT_CHIP: Record<UserLedgerEntry["type"], string> = {
  cancellation_penalty: "bg-danger-100 text-danger-700",
  penalty_capture: "bg-danger-100 text-danger-700",
  cash_commission: "bg-warning-100 text-warning-700",
  fee_offset: "bg-info-100 text-info-700",
  payment_surcharge: "bg-warning-100 text-warning-700",
  voluntary_payment: "bg-success-100 text-success-700",
  manual_adjustment: "bg-bg-mute text-fg-2",
};

function Movement({ entry }: { entry: UserLedgerEntry }) {
  const colors = useThemeColors();
  const role = balanceEntryRole(entry);
  const date = new Date(entry.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  const voided = entry.status === "voided";
  return (
    <View testID={`balance-entry-${entry.id}`} className={`flex-row justify-between gap-3 border-b border-border px-3.5 py-3 ${voided ? "opacity-50" : ""}`}>
      <View className="min-w-0 flex-1 gap-1.5">
        <View className="self-start rounded-full">
          <Text className={`rounded-full px-2 py-0.5 font-sans-medium text-[11px] ${voided ? "bg-bg-mute text-fg-3" : MOVEMENT_CHIP[entry.type]}`}>
            {balanceEntryLabel(entry)}{voided ? " · Anulado" : ""}
          </Text>
        </View>
        <Pressable accessibilityRole={entry.shipmentId ? "button" : undefined} disabled={!entry.shipmentId} onPress={() => entry.shipmentId && router.push(`/shipments/${entry.shipmentId}` as never)} className="flex-row items-center gap-0.5">
          <Text numberOfLines={2} className="min-w-0 font-sans-semibold text-[14px] text-fg">{balanceEntryOrigin(entry)}</Text>
          {entry.shipmentId ? <ChevronRight size={14} color={colors.fg3} strokeWidth={2} /> : null}
        </Pressable>
        <Text className="font-sans text-[12px] text-fg-3">{[role, date].filter(Boolean).join(" · ")}</Text>
      </View>
      <Text className={`pt-5 font-sans-semibold text-[14px] ${voided ? "text-fg-3" : entry.amountArs > 0 ? "text-danger-600" : "text-success-700"}`}>{balanceEntryAmount(entry)}</Text>
    </View>
  );
}

export function BalanceTab({ openPay, onPayOpened }: { openPay?: boolean; onPayOpened?: () => void }) {
  const colors = useThemeColors();
  const balance = useBalance();
  const cards = useSavedCards();
  const [payOpen, setPayOpen] = useState(false);
  const page = balance.data?.pages[0];
  const amount = page?.balanceArs ?? 0;
  const entries = balance.data?.pages.flatMap((p) => p.items) ?? [];
  useEffect(() => { if (openPay) { setPayOpen(true); onPayOpened?.(); } }, [openPay, onPayOpened]);

  return (
    <>
      <ScrollView testID="balance-tab" contentContainerClassName="gap-4 px-5 pb-8 pt-4" refreshControl={<RefreshControl refreshing={balance.isRefetching && !balance.isFetchingNextPage} onRefresh={() => void balance.refetch()} />}>
        {balance.isPending ? <ActivityIndicator /> : balance.isError ? <View className="gap-2"><Text className="font-sans text-danger-600">No pudimos consultar tu saldo.</Text><Pressable accessibilityRole="button" onPress={() => void balance.refetch()}><Text className="font-sans-semibold text-fg">Reintentar</Text></Pressable></View> : (
          <>
            {amount > 0 ? <View className="gap-3 rounded-[14px] border border-danger-200 p-4"><View><Text className="font-sans-medium text-[11px] uppercase tracking-wider text-danger-700">Saldo pendiente</Text><Text testID="balance-amount" className="mt-1 font-sans-semibold text-[30px] text-danger-600">{formatPriceArs(amount)}</Text><Text className="mt-1 font-sans text-[13px] text-fg-2">Lo descontamos de tus próximos cobros o se suma a tu próximo pago. También podés pagarlo ahora.</Text></View><Pressable accessibilityRole="button" onPress={() => setPayOpen(true)} className="items-center rounded-lg bg-lime-500 py-3"><Text className="font-sans-semibold text-ink-950">Pagar mi saldo</Text></Pressable></View>
              : <View className="flex-row items-center gap-3 rounded-[14px] border border-success-200 bg-success-100 p-4">
                  <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-500" testID="balance-status-icon"><Check size={19} color="#FFFFFF" strokeWidth={2.6} /></View>
                  <View className="min-w-0 flex-1"><Text className="font-sans-semibold text-[17px] text-success-700">{amount < 0 ? "Tenés saldo a favor" : "Estás al día"}</Text><Text className="mt-0.5 font-sans text-[13px] text-fg-2">{amount < 0 ? `${formatPriceArs(Math.abs(amount))} a favor en tu cuenta corriente.` : "No tenés saldo pendiente con Movo."}</Text></View>
                </View>}
            <View className="mt-1"><Text className="font-sans-semibold text-caption uppercase text-fg-3">Movimientos</Text><Text className="mt-1 font-sans text-[13px] text-fg-2">Penalidades, descuentos, recargos y pagos de tu saldo.</Text></View>
            {entries.length === 0 ? <View className="items-center gap-1.5 rounded-[10px] border border-dashed border-border-strong px-5 py-7">
                <View testID="balance-empty-icon" className="mb-1 h-10 w-10 items-center justify-center rounded-full bg-bg-mute"><Receipt size={20} color={colors.fg2} strokeWidth={1.8} /></View>
                <Text className="text-center font-sans-semibold text-[15px] text-fg">Todavía no tenés movimientos</Text>
                <Text className="text-center font-sans text-[13px] leading-[18px] text-fg-3">Si alguna vez cancelás un envío con cargo, lo vas a ver acá.</Text>
              </View> : <View className="overflow-hidden rounded-[10px] border border-border">{entries.map((entry) => <Movement key={entry.id} entry={entry} />)}{balance.hasNextPage ? <Pressable accessibilityRole="button" disabled={balance.isFetchingNextPage} onPress={() => void balance.fetchNextPage()} className="flex-row items-center justify-center gap-2 py-3.5">{balance.isFetchingNextPage ? <ActivityIndicator size="small" color={colors.fg1} /> : null}<Text className="font-sans-medium text-[14px] text-fg">{balance.isFetchingNextPage ? "Cargando…" : "Cargar más"}</Text></Pressable> : <Text className="py-3 text-center font-sans text-[12px] text-fg-3">No hay más movimientos</Text>}</View>}
          </>
        )}
      </ScrollView>
      <BalancePaySheet visible={payOpen} onClose={() => { setPayOpen(false); void balance.refetch(); }} cards={cards.data} initialBalanceArs={amount} />
    </>
  );
}
