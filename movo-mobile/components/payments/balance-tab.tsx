import type { UserLedgerEntry } from "@movo/shared/dist/types/user-ledger";
import { router } from "expo-router";
import { ChevronRight, CircleAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useBalance } from "../../src/hooks/use-balance";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { balanceEntryAmount, balanceEntryLabel, balanceEntryOrigin, balanceEntryRole } from "../../src/lib/balance-format";
import { formatPriceArs } from "../../src/lib/shipment-format";
import { BalancePaySheet } from "./balance-pay-sheet";
import { useSavedCards } from "../../src/hooks/use-saved-cards";

/**
 * Una deuda abierta (penalidad, comisión en efectivo, recargo). Los pagos y las deudas ya saldadas
 * o anuladas no se listan: cada evento vive en un solo lugar (prototipo "Pagos y cobros 2c").
 */
function isOpenDebt(entry: UserLedgerEntry): boolean {
  return entry.amountArs > 0 && (entry.status === "pending" || entry.status === "reserved");
}

function DebtEntry({ entry }: { entry: UserLedgerEntry }) {
  const colors = useThemeColors();
  const role = balanceEntryRole(entry);
  const date = new Date(entry.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  return (
    <View testID={`balance-entry-${entry.id}`} className="flex-row items-center gap-3 border-b border-border py-3">
      <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full border border-danger-200 bg-danger-100">
        <CircleAlert size={17} color="#972327" strokeWidth={2} />
      </View>
      <Pressable accessibilityRole={entry.shipmentId ? "button" : undefined} disabled={!entry.shipmentId} onPress={() => entry.shipmentId && router.push(`/shipments/${entry.shipmentId}` as never)} className="min-w-0 flex-1">
        <View className="flex-row items-center gap-0.5">
          <Text numberOfLines={2} className="min-w-0 shrink font-sans-semibold text-[13.5px] leading-[18px] text-fg">{balanceEntryLabel(entry)} · {balanceEntryOrigin(entry)}</Text>
          {entry.shipmentId ? <ChevronRight size={14} color={colors.fg3} strokeWidth={2} /> : null}
        </View>
        <Text className="font-sans text-[11.5px] leading-4 text-fg-3">{[role, date].filter(Boolean).join(" · ")}</Text>
      </Pressable>
      <View className="items-end gap-1">
        <Text className="font-sans-semibold text-[13.5px] text-danger-600" style={{ fontVariant: ["tabular-nums"] }}>{balanceEntryAmount(entry)}</Text>
        <Text className="rounded-full bg-danger-100 px-2 py-0.5 font-sans-semibold text-[10.5px] text-danger-700">Por pagar</Text>
      </View>
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
  const entries = (balance.data?.pages.flatMap((p) => p.items) ?? []).filter(isOpenDebt);
  useEffect(() => { if (openPay) { setPayOpen(true); onPayOpened?.(); } }, [openPay, onPayOpened]);

  return (
    <>
      <ScrollView testID="balance-tab" contentContainerClassName="gap-4 px-5 pb-8 pt-4" refreshControl={<RefreshControl refreshing={balance.isRefetching && !balance.isFetchingNextPage} onRefresh={() => void balance.refetch()} />}>
        {balance.isPending ? <ActivityIndicator /> : balance.isError ? <View className="gap-2"><Text className="font-sans text-danger-600">No pudimos consultar tu saldo.</Text><Pressable accessibilityRole="button" onPress={() => void balance.refetch()}><Text className="font-sans-semibold text-fg">Reintentar</Text></Pressable></View> : (
          <>
            {amount > 0 ? <View className="gap-3 rounded-[14px] border border-danger-200 p-4"><View><Text className="font-sans-medium text-[11px] uppercase tracking-wider text-danger-700">Saldo pendiente</Text><Text testID="balance-amount" className="mt-1 font-sans-semibold text-[30px] text-danger-600">{formatPriceArs(amount)}</Text><Text className="mt-1 font-sans text-[13px] text-fg-2">Lo descontamos de tus próximos cobros o se suma a tu próximo pago. También podés pagarlo ahora.</Text></View><Pressable accessibilityRole="button" onPress={() => setPayOpen(true)} className="h-11 items-center justify-center rounded-lg bg-fg active:opacity-80"><Text className="font-sans-semibold text-[14px] text-bg">Pagar mi saldo</Text></Pressable></View>
              : <View testID="balance-status" className="rounded-[14px] border border-border p-4"><Text className="font-sans-medium text-[11px] uppercase tracking-wider text-fg-2">Saldo</Text><Text className="mt-1 font-sans-semibold text-[30px] text-fg">{amount < 0 ? formatPriceArs(Math.abs(amount)) : "$0"}</Text><Text className="mt-1 font-sans text-[13px] text-fg-2">{amount < 0 ? "Tenés saldo a favor en tu cuenta corriente." : "Estás al día. Si te toca una penalidad, la vas a ver acá."}</Text></View>}
            {entries.length > 0 || balance.hasNextPage ? <View>
                <Text className="mb-1 mt-1 font-sans-semibold text-caption uppercase text-fg-3">Qué forma tu saldo</Text>
                {entries.map((entry) => <DebtEntry key={entry.id} entry={entry} />)}
                {balance.hasNextPage ? <Pressable accessibilityRole="button" disabled={balance.isFetchingNextPage} onPress={() => void balance.fetchNextPage()} className="flex-row items-center justify-center gap-2 py-3.5">{balance.isFetchingNextPage ? <ActivityIndicator size="small" color={colors.fg1} /> : null}<Text className="font-sans-medium text-[14px] text-fg">{balance.isFetchingNextPage ? "Cargando…" : "Cargar más"}</Text></Pressable> : null}
              </View> : null}
          </>
        )}
      </ScrollView>
      <BalancePaySheet visible={payOpen} onClose={() => { setPayOpen(false); void balance.refetch(); }} cards={cards.data} initialBalanceArs={amount} />
    </>
  );
}
