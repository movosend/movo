import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useBalancePayData, useRefreshBalance } from "../../src/hooks/use-balance";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { payBalanceWithSavedCard } from "../../src/lib/pay-balance-flow";
import { cvvLengthFor, defaultPayableCard, rejectionCopy } from "../../src/lib/pay-shipment-format";
import { isCardExpired } from "../../src/lib/saved-cards";
import { formatPriceArs } from "../../src/lib/shipment-format";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { PayCardRow } from "./pay-card-row";

type Result = "form" | "processing" | "approved" | "pending";

function parseAmount(value: string): number {
  const raw = value.trim().replace(/[\s$]/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  return Number(normalized);
}

export function BalancePaySheet({ visible, onClose, cards, initialBalanceArs }: { visible: boolean; onClose: () => void; cards: SavedCard[] | undefined; initialBalanceArs: number }) {
  const payData = useBalancePayData(visible);
  const refresh = useRefreshBalance();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cvv, setCvv] = useState("");
  const [mode, setMode] = useState<"total" | "partial">("total");
  const [partial, setPartial] = useState("");
  const [result, setResult] = useState<Result>("form");
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [addAfterClose, setAddAfterClose] = useState(false);
  const selected = (selectedId && cards?.find((card) => card.id === selectedId && !isCardExpired(card))) ||
    (cards ? defaultPayableCard(cards) : null);
  const balance = payData.data?.balanceArs ?? initialBalanceArs;
  const amount = mode === "total" ? balance : parseAmount(partial);
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= balance;
  const busy = result === "processing";

  useEffect(() => {
    if (!visible) {
      setCvv("");
      setResult("form");
      setError(null);
      setMode("total");
      setPartial("");
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || result !== "pending") return;
    const timer = setInterval(() => { refresh(); void payData.refetch(); }, 5000);
    return () => clearInterval(timer);
  }, [visible, result, payData.refetch, refresh]);

  const submit = async () => {
    if (busy || !payData.data || !selected || !amountValid || cvv.length !== cvvLengthFor(selected)) return;
    setResult("processing");
    setError(null);
    const typedCvv = cvv;
    setCvv("");
    try {
      const response = await payBalanceWithSavedCard({ payData: payData.data, card: selected, cvv: typedCvv, amountArs: amount });
      refresh();
      if (response.status === "approved") {
        setPaid(amount);
        setRemaining(response.balanceArs);
        setResult("approved");
      } else if (response.status === "pending") {
        setResult("pending");
      } else {
        setResult("form");
        setError(rejectionCopy(response.failureReason ?? "card_rejected", formatPriceArs(amount), "tarjeta").body);
      }
    } catch (cause) {
      setError(friendlyErrorMessage(cause, "No pudimos confirmar el pago. Consultá tu saldo antes de volver a intentar."));
      refresh();
      await payData.refetch();
      setResult("form");
      if (cause instanceof ApiError && cause.code === "SAVED_CARD_NOT_FOUND") setSelectedId(null);
    }
  };

  return (
    <BottomSheetModal visible={visible} onRequestClose={() => { if (!busy) onClose(); }} onClosed={() => { if (addAfterClose) { setAddAfterClose(false); router.push("/profile/payments/add-card"); } }} testID="balance-pay-sheet" backdropTestID="balance-pay-backdrop" avoidKeyboard sheetClassName="rounded-t-2xl bg-bg px-5 pt-5" contentClassName="max-h-[90%]">
      <ScrollView contentContainerClassName="gap-4 pb-5" keyboardShouldPersistTaps="handled">
        {result === "approved" ? (
          <View className="items-center gap-3 py-5">
            <Text className="font-sans-semibold text-[24px] text-fg">Pagaste {formatPriceArs(paid)}</Text>
            <Text className="font-sans text-[14px] text-fg-2">{remaining > 0 ? `Te quedan ${formatPriceArs(remaining)} pendientes.` : "Ya no tenés saldo pendiente."}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} className="w-full items-center rounded-xl bg-fg py-3.5"><Text className="font-sans-semibold text-bg">Listo</Text></Pressable>
          </View>
        ) : result === "pending" ? (
          <View className="items-center gap-3 py-5">
            <Text className="font-sans-semibold text-[21px] text-fg">Estamos confirmando tu pago</Text>
            <Text className="text-center font-sans text-[14px] text-fg-2">El saldo se actualizará cuando Mercado Pago confirme la operación.</Text>
            <Pressable accessibilityRole="button" onPress={onClose} className="w-full items-center rounded-xl bg-fg py-3.5"><Text className="font-sans-semibold text-bg">Entendido</Text></Pressable>
          </View>
        ) : (
          <>
            <View><Text className="font-sans-semibold text-[17px] text-fg">Pagar mi saldo</Text><Text className="mt-1 font-sans text-[13px] text-fg-2">Tenés {formatPriceArs(balance)} pendientes.</Text></View>
            {payData.isError ? <View className="gap-2"><Text className="font-sans text-danger-600">{friendlyErrorMessage(payData.error, "No pudimos consultar el saldo.")}</Text><Pressable accessibilityRole="button" onPress={() => void payData.refetch()}><Text className="font-sans-semibold text-fg">Reintentar</Text></Pressable></View> : null}
            <View className="gap-2"><Text className="font-sans-medium text-caption uppercase text-fg-3">Tarjeta</Text>
              {cards?.map((card) => <PayCardRow key={card.id} card={card} selected={selected?.id === card.id} locked={busy} cvv={selected?.id === card.id ? cvv : ""} cvvError={false} onSelect={() => { setSelectedId(card.id); setCvv(""); setError(null); }} onCvvChange={setCvv} onSubmit={() => void submit()} />)}
              <Pressable accessibilityRole="button" onPress={() => { setAddAfterClose(true); onClose(); }} className="rounded-lg border border-border p-3"><Text className="font-sans-medium text-fg">Agregar tarjeta</Text></Pressable>
            </View>
            <View className="gap-2"><Text className="font-sans-medium text-caption uppercase text-fg-3">Monto</Text>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode === "total" }} onPress={() => setMode("total")} className="flex-row justify-between rounded-lg border border-border p-3"><Text className="font-sans text-fg">Pagar el total</Text><Text className="font-sans-semibold text-fg">{formatPriceArs(balance)}</Text></Pressable>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode === "partial" }} onPress={() => setMode("partial")} className="rounded-lg border border-border p-3"><Text className="font-sans text-fg">Otro monto</Text></Pressable>
              {mode === "partial" ? <><TextInput testID="balance-partial-amount" keyboardType="decimal-pad" value={partial} onChangeText={setPartial} placeholder="$ 0" className="rounded-lg border border-border px-3 py-3 font-sans-semibold text-fg" />
                <Text className={`font-sans text-[12px] ${partial && !amountValid ? "text-danger-600" : "text-fg-3"}`}>{partial && !amountValid ? `Ingresá un monto entre $0,01 y ${formatPriceArs(balance)}.` : amountValid ? `Te van a quedar ${formatPriceArs(balance - amount)} pendientes.` : `Hasta ${formatPriceArs(balance)}`}</Text></> : null}
            </View>
            {error ? <Text testID="balance-pay-error" className="rounded-lg bg-danger-100 p-3 font-sans text-danger-700">{error}</Text> : null}
            <Pressable testID="balance-pay-submit" accessibilityRole="button" disabled={busy || !amountValid || !selected || cvv.length !== cvvLengthFor(selected)} onPress={() => void submit()} className={`items-center rounded-xl bg-lime-500 py-3.5 ${busy || !amountValid || !selected || cvv.length !== cvvLengthFor(selected) ? "opacity-50" : ""}`}>
              {busy ? <ActivityIndicator color="#0A0A0B" /> : <Text className="font-sans-semibold text-ink-950">Pagar {amountValid ? formatPriceArs(amount) : ""}</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </BottomSheetModal>
  );
}
