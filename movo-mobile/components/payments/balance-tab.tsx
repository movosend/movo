import type { UserLedgerEntry } from "@movo/shared/dist/types/user-ledger";
import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useBalance } from "../../src/hooks/use-balance";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { balanceEntryAmount, balanceEntryLabel, balanceEntryRole, balanceEntryTitle, formatBalanceArs } from "../../src/lib/balance-format";
import { BalancePaySheet } from "./balance-pay-sheet";
import { useSavedCards } from "../../src/hooks/use-saved-cards";

/**
 * Una deuda abierta (penalidad, comisión en efectivo, recargo). Los pagos y las deudas ya saldadas
 * o anuladas no se listan: cada evento vive en un solo lugar (prototipo "Pagos y cobros 2c").
 */
function isOpenDebt(entry: UserLedgerEntry): boolean {
  return entry.amountArs > 0 && (entry.status === "pending" || entry.status === "reserved");
}

// Color del tipo: lo que el usuario hizo (penalidad) en rojo, lo que le cobramos nosotros en ámbar, un ajuste neutro.
const TYPE_CHIP: Partial<Record<UserLedgerEntry["type"], string>> = {
  cancellation_penalty: "bg-danger-100 text-danger-700",
  penalty_capture: "bg-danger-100 text-danger-700",
  cash_commission: "bg-warning-100 text-warning-700",
  payment_surcharge: "bg-warning-100 text-warning-700",
};

/**
 * Una deuda de la lista. Jerarquía: el origen es lo primero que se lee (qué envío), el tipo es una etiqueta
 * chica arriba, y el rol y la fecha son contexto. Todas son "Por pagar" por definición (es la lista de lo
 * que se debe), así que no se repite un estado en cada fila: solo se aclara la que ya se está cobrando.
 */
function DebtEntry({ entry, last }: { entry: UserLedgerEntry; last: boolean }) {
  const colors = useThemeColors();
  const role = balanceEntryRole(entry);
  const date = new Date(entry.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  const openable = !!entry.shipmentId;
  return (
    <Pressable
      testID={`balance-entry-${entry.id}`}
      accessibilityRole={openable ? "button" : undefined}
      disabled={!openable}
      onPress={() => entry.shipmentId && router.push(`/shipments/${entry.shipmentId}` as never)}
      className={`flex-row items-center gap-3 px-4 py-4 ${last ? "" : "border-b border-border"} ${openable ? "active:bg-bg-sub" : ""}`}
    >
      <View className="min-w-0 flex-1 gap-1.5">
        <Text className={`self-start overflow-hidden rounded-full px-2 py-0.5 font-sans-medium text-[11px] ${TYPE_CHIP[entry.type] ?? "bg-bg-mute text-fg-2"}`}>{balanceEntryLabel(entry)}</Text>
        <View className="flex-row items-center gap-1">
          <Text numberOfLines={1} className="shrink font-sans-semibold text-[15px] leading-5 text-fg">{balanceEntryTitle(entry)}</Text>
          {openable ? <ChevronRight size={15} color={colors.fg3} strokeWidth={2} /> : null}
        </View>
        <Text numberOfLines={1} className="font-sans text-[12.5px] leading-4 text-fg-2">{[role, date].filter(Boolean).join(" · ")}</Text>
      </View>
      <View className="items-end gap-1">
        <Text className="font-sans-semibold text-[15px] text-danger-600" style={{ fontVariant: ["tabular-nums"] }}>{balanceEntryAmount(entry)}</Text>
        {entry.status === "reserved" ? <Text className="font-sans text-[11.5px] text-fg-3">En proceso</Text> : null}
      </View>
    </Pressable>
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
  // El endpoint pagina todos los movimientos. Si la página visible solo contiene pagos o
  // deudas cerradas, avanzar hasta encontrar una deuda o agotar las páginas.
  useEffect(() => {
    if (amount > 0 && entries.length === 0 && balance.hasNextPage &&
        !balance.isFetchingNextPage && !balance.isFetchNextPageError) {
      void balance.fetchNextPage();
    }
  }, [amount, entries.length, balance.hasNextPage, balance.isFetchingNextPage, balance.isFetchNextPageError, balance.fetchNextPage]);

  return (
    <>
      <ScrollView testID="balance-tab" contentContainerClassName="gap-6 px-5 pb-10 pt-5" refreshControl={<RefreshControl refreshing={balance.isRefetching && !balance.isFetchingNextPage} onRefresh={() => void balance.refetch()} />}>
        {balance.isPending ? <ActivityIndicator /> : balance.isError ? <View className="gap-2"><Text className="font-sans text-danger-600">No pudimos consultar tu saldo.</Text><Pressable accessibilityRole="button" onPress={() => void balance.refetch()}><Text className="font-sans-semibold text-fg">Reintentar</Text></Pressable></View> : (
          <>
            {amount > 0 ? <View className="gap-4 rounded-[14px] border border-danger-200 p-5"><View><Text className="font-sans-medium text-[11px] uppercase tracking-wider text-danger-700">Saldo pendiente</Text><Text testID="balance-amount" className="mt-1.5 font-sans-semibold text-[32px] leading-[38px] text-danger-600">{formatBalanceArs(amount)}</Text><Text className="mt-2 font-sans text-[13.5px] leading-[20px] text-fg-2">Lo descontamos de tus próximos cobros o se suma a tu próximo pago. También podés pagarlo ahora.</Text></View><Pressable accessibilityRole="button" onPress={() => setPayOpen(true)} className="h-12 items-center justify-center rounded-lg bg-fg active:opacity-80"><Text className="font-sans-semibold text-[14px] text-bg">Pagar mi saldo</Text></Pressable></View>
              : <View testID="balance-status" className="rounded-[14px] border border-border p-5"><Text className="font-sans-medium text-[11px] uppercase tracking-wider text-fg-2">Saldo</Text><Text className="mt-1 font-sans-semibold text-[30px] text-fg">{amount < 0 ? formatBalanceArs(Math.abs(amount)) : "$0"}</Text><Text className="mt-2 font-sans text-[13.5px] leading-[20px] text-fg-2">{amount < 0 ? "Tenés saldo a favor en tu cuenta corriente." : "Estás al día. Si te toca una penalidad, la vas a ver acá."}</Text></View>}
            {entries.length > 0 || balance.hasNextPage ? <View>
                <Text className="mb-3 font-sans-semibold text-caption uppercase text-fg-3">Qué forma tu saldo</Text>
                <View className="overflow-hidden rounded-[10px] border border-border">
                  {entries.map((entry, index) => <DebtEntry key={entry.id} entry={entry} last={index === entries.length - 1 && !balance.hasNextPage} />)}
                {balance.hasNextPage ? <Pressable accessibilityRole="button" disabled={balance.isFetchingNextPage || (entries.length === 0 && !balance.isFetchNextPageError)} onPress={() => void balance.fetchNextPage()} className="flex-row items-center justify-center gap-2 border-t border-border py-4">{balance.isFetchingNextPage || (entries.length === 0 && !balance.isFetchNextPageError) ? <ActivityIndicator size="small" color={colors.fg1} /> : null}<Text className="font-sans-medium text-[14px] text-fg">{balance.isFetchNextPageError ? "Reintentar" : balance.isFetchingNextPage || entries.length === 0 ? "Buscando deudas…" : "Cargar más"}</Text></Pressable> : null}
                </View>
              </View> : null}
          </>
        )}
      </ScrollView>
      <BalancePaySheet visible={payOpen} onClose={() => { setPayOpen(false); void balance.refetch(); }} cards={cards.data} initialBalanceArs={amount} />
    </>
  );
}
