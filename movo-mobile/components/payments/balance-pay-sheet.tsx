import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { router } from "expo-router";
import { Check, ChevronRight, Plus } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBalancePayData, useRefreshBalance } from "../../src/hooks/use-balance";
import { useKeyboardHeight } from "../../src/hooks/use-keyboard-height";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatBalanceAmountInput, parseBalanceAmountInput } from "../../src/lib/balance-format";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { payBalanceWithSavedCard } from "../../src/lib/pay-balance-flow";
import { cvvLengthFor, defaultPayableCard, rejectionCopy } from "../../src/lib/pay-shipment-format";
import { isCardExpired } from "../../src/lib/saved-cards";
import { formatPriceArs } from "../../src/lib/shipment-format";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { SheetOutlineButton } from "./card-sheet-buttons";
import { PayCardRow } from "./pay-card-row";

type Result = "form" | "processing" | "approved" | "pending";

/** Aire entre el borde superior de la hoja y la barra de estado / Dynamic Island. */
const SHEET_TOP_GAP = 12;
/** `pt-5` de la hoja: se descuenta del alto disponible para el contenido. */
const SHEET_PADDING_TOP = 20;

/** Qué se le dice a la persona cuando no se pueden traer los datos de pago, según el motivo. */
function payDataErrorCopy(error: unknown): { title: string; body: string; retryable: boolean } {
  const code = error instanceof ApiError ? error.code : null;
  if (code === "BALANCE_COLLECTOR_NOT_CONFIGURED") {
    return {
      title: "Por ahora no podés pagar el saldo con tarjeta",
      body: "Estamos resolviendo un problema de nuestro lado. Tu saldo no cambió: se descuenta solo de tus próximos cobros o se suma a tu próximo pago.",
      retryable: false,
    };
  }
  if (code === "BALANCE_AMOUNT_EXCEEDS_DEBT") {
    return { title: "No tenés saldo pendiente", body: "Ya no hay nada para pagar. Si acabás de pagar, tu saldo ya está al día.", retryable: false };
  }
  return {
    title: "No pudimos preparar el pago",
    body: friendlyErrorMessage(error, "Revisá tu conexión y probá de nuevo. No se cobró nada."),
    retryable: true,
  };
}

/** Opción de monto con el mismo marco que la fila de tarjeta elegida (`PayCardRow`). */
function AmountOption({ selected, label, trailing, onPress, testID, disabled, children }: { selected: boolean; label: string; trailing?: ReactNode; onPress: () => void; testID: string; disabled: boolean; children?: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View
      className={`rounded-[10px] ${selected ? "bg-bg-sub" : "bg-bg"}`}
      style={{ borderWidth: selected ? 1.5 : 1, borderColor: selected ? colors.fg1 : colors.border, margin: selected ? 0 : 0.5 }}
    >
      <Pressable testID={testID} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} className="flex-row items-center gap-3 p-3.5">
        <View className="h-5 w-5 rounded-full bg-bg" style={{ borderWidth: selected ? 6 : 1.5, borderColor: selected ? colors.fg1 : colors.borderStrong }} />
        <Text className="min-w-0 flex-1 font-sans-medium text-[15px] text-fg">{label}</Text>
        {trailing}
      </Pressable>
      {children}
    </View>
  );
}

export function BalancePaySheet({ visible, onClose, cards, initialBalanceArs }: { visible: boolean; onClose: () => void; cards: SavedCard[] | undefined; initialBalanceArs: number }) {
  const colors = useThemeColors();
  const payData = useBalancePayData(visible);
  const refresh = useRefreshBalance();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);
  const amountRef = useRef<TextInput>(null);
  const [amountFocused, setAmountFocused] = useState(false);
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
  const amount = mode === "total" ? balance : parseBalanceAmountInput(partial);
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= balance;
  const busy = result === "processing";
  const cvvReady = !!selected && cvv.length === cvvLengthFor(selected);
  const canSubmit = !busy && !!payData.data && amountValid && cvvReady;
  // Sin los datos de pago no se puede tokenizar: se reemplaza el formulario en vez de dejarlo a medias.
  const payDataFailed = payData.isError && !payData.data;

  // La hoja nunca pasa la barra de estado ni queda detrás del teclado: el contenido scrollea y
  // el botón de pagar queda fijo abajo, siempre a la vista.
  // Con el teclado abierto `BottomSheetModal` saca el margen inferior del indicador de inicio.
  const maxContentHeight = windowHeight - insets.top - SHEET_TOP_GAP - SHEET_PADDING_TOP - (keyboardHeight > 0 ? keyboardHeight : insets.bottom);

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

  // El campo de "Otro monto" es lo último del formulario: al abrir el teclado se lleva a la vista.
  useEffect(() => {
    if (keyboardHeight > 0 && amountFocused) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [keyboardHeight, amountFocused]);

  const choosePartial = () => {
    setMode("partial");
    setError(null);
    requestAnimationFrame(() => amountRef.current?.focus());
  };

  const chooseTotal = () => {
    setMode("total");
    setError(null);
    amountRef.current?.blur();
  };

  const submit = async () => {
    if (!canSubmit || !payData.data || !selected) return;
    Keyboard.dismiss();
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

  const amountHint = partial && !amountValid
    ? `Ingresá un monto de hasta ${formatPriceArs(balance)}.`
    : amountValid
      ? balance - amount > 0 ? `Te van a quedar ${formatPriceArs(balance - amount)} pendientes.` : "Cancelás todo tu saldo."
      : `Hasta ${formatPriceArs(balance)}.`;

  let body: ReactNode;
  if (result === "approved") {
    body = (
      <View className="items-center gap-3 pb-3 pt-2">
        <View testID="balance-pay-success-icon" className="mb-2 h-16 w-16 items-center justify-center rounded-full border-8 border-lime-200 bg-lime-500"><Check size={30} color="#0A0A0B" strokeWidth={2.6} /></View>
        <Text className="font-sans-semibold text-[24px] text-fg">Pagaste {formatPriceArs(paid)}</Text>
        <Text className="font-sans text-[14px] text-fg-2">{remaining > 0 ? `Te quedan ${formatPriceArs(remaining)} pendientes.` : "Ya no tenés saldo pendiente."}</Text>
        <Pressable accessibilityRole="button" onPress={onClose} className="mt-2 h-[50px] w-full items-center justify-center rounded-lg bg-fg"><Text className="font-sans-semibold text-[15px] text-bg">Listo</Text></Pressable>
      </View>
    );
  } else if (result === "pending") {
    body = (
      <View className="items-center gap-3 pb-3 pt-2">
        <Text className="font-sans-semibold text-[21px] text-fg">Estamos confirmando tu pago</Text>
        <Text className="text-center font-sans text-[14px] text-fg-2">El saldo se actualizará cuando Mercado Pago confirme la operación.</Text>
        <Pressable accessibilityRole="button" onPress={onClose} className="mt-2 h-[50px] w-full items-center justify-center rounded-lg bg-fg"><Text className="font-sans-semibold text-[15px] text-bg">Entendido</Text></Pressable>
      </View>
    );
  } else if (!payData.data && !payData.isError) {
    // Sin los datos de pago no se muestra el formulario: si después fallaran, se cambiaría por el error
    // mientras la persona escribe.
    body = (
      <View testID="balance-pay-loading" className="items-center gap-3 pb-6 pt-4">
        <ActivityIndicator color={colors.fg1} />
        <Text className="font-sans text-[14px] text-fg-2">Preparando el pago…</Text>
      </View>
    );
  } else if (payDataFailed) {
    const payDataError = payDataErrorCopy(payData.error);
    body = (
      <View testID="balance-pay-data-error" className="gap-5 pb-3">
        <View>
          <Text className="font-sans-semibold text-[17px] leading-[22px] text-fg">{payDataError.title}</Text>
          <Text className="mt-1.5 font-sans text-[14px] leading-5 text-fg-2">{payDataError.body}</Text>
        </View>
        <View className="gap-2.5">
          {payDataError.retryable ? (
            <SheetOutlineButton testID="balance-pay-data-retry" label={payData.isFetching ? "Reintentando…" : "Reintentar"} disabled={payData.isFetching} onPress={() => void payData.refetch()} />
          ) : null}
          <Pressable testID="balance-pay-data-close" accessibilityRole="button" onPress={onClose} className={payDataError.retryable ? "h-11 items-center justify-center" : "h-[50px] items-center justify-center rounded-lg bg-fg active:opacity-80"}>
            <Text className={payDataError.retryable ? "font-sans-medium text-[15px] text-fg-2" : "font-sans-semibold text-[15px] text-bg"}>{payDataError.retryable ? "Cerrar" : "Entendido"}</Text>
          </Pressable>
        </View>
      </View>
    );
  } else {
    body = (
      <View style={{ maxHeight: maxContentHeight }}>
        <ScrollView ref={scrollRef} style={{ flexGrow: 0 }} contentContainerClassName="gap-5 pb-4" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets={false} bounces={false}>
          <View>
            <Text className="font-sans-semibold text-[17px] text-fg">Pagar mi saldo</Text>
            <Text className="mt-1 font-sans text-[13px] text-fg-2">Tenés {formatPriceArs(balance)} pendientes.</Text>
          </View>
          <View className="gap-2">
            <Text className="font-sans-medium text-caption uppercase text-fg-3">Tarjeta</Text>
            {cards?.map((card) => <PayCardRow key={card.id} card={card} selected={selected?.id === card.id} locked={busy} cvv={selected?.id === card.id ? cvv : ""} cvvError={false} onSelect={() => { setSelectedId(card.id); setCvv(""); setError(null); }} onCvvChange={setCvv} onSubmit={() => void submit()} />)}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setAddAfterClose(true); onClose(); }} className="flex-row items-center gap-3 rounded-[10px] border border-border p-3.5">
              <View className="h-[30px] w-11 items-center justify-center rounded-md border border-dashed border-border-strong"><Plus size={16} color={colors.fg2} strokeWidth={2} /></View>
              <Text className="min-w-0 flex-1 font-sans-medium text-[15px] text-fg">Agregar tarjeta</Text>
              <ChevronRight size={16} color={colors.fg3} strokeWidth={2} />
            </Pressable>
          </View>
          <View className="gap-2">
            <Text className="font-sans-medium text-caption uppercase text-fg-3">Monto</Text>
            <AmountOption testID="balance-amount-total" selected={mode === "total"} label="Pagar el total" disabled={busy} onPress={chooseTotal} trailing={<Text className="font-sans-semibold text-[15px] text-fg">{formatPriceArs(balance)}</Text>} />
            <AmountOption testID="balance-amount-partial" selected={mode === "partial"} label="Otro monto" disabled={busy} onPress={choosePartial}>
              {mode === "partial" ? (
                <View className="gap-1.5 pb-3.5 pl-[46px] pr-3.5">
                  <View
                    className="h-12 flex-row items-center rounded-md bg-bg px-3"
                    style={{ borderWidth: amountFocused ? 1.5 : 1, borderColor: amountFocused ? colors.fg1 : partial && !amountValid ? "#E5484D" : colors.borderStrong }}
                  >
                    <Text className="mr-1 font-sans-semibold text-[18px] text-fg-3">$</Text>
                    <TextInput
                      ref={amountRef}
                      testID="balance-partial-amount"
                      accessibilityLabel="Monto a pagar"
                      keyboardType="number-pad"
                      value={partial}
                      onChangeText={(text) => { setPartial(formatBalanceAmountInput(text)); setError(null); }}
                      onFocus={() => setAmountFocused(true)}
                      onBlur={() => setAmountFocused(false)}
                      editable={!busy}
                      placeholder="0"
                      placeholderTextColor={colors.fg3}
                      className="h-full min-w-0 flex-1 font-sans-semibold text-[18px] text-fg"
                      style={{ paddingVertical: 0, ...(Platform.OS === "android" ? { textAlignVertical: "center" } : null) }}
                    />
                  </View>
                  <Text testID="balance-partial-hint" className={`font-sans text-[12px] leading-[17px] ${partial && !amountValid ? "text-danger-600" : "text-fg-3"}`}>{amountHint}</Text>
                </View>
              ) : null}
            </AmountOption>
          </View>
        </ScrollView>
        <View className="gap-3 border-t border-border pb-2 pt-3">
          {error ? <Text testID="balance-pay-error" className="rounded-lg bg-danger-100 p-3 font-sans text-[13px] text-danger-700">{error}</Text> : null}
          <Pressable testID="balance-pay-submit" accessibilityRole="button" accessibilityState={{ disabled: !canSubmit, busy }} disabled={!canSubmit} onPress={() => void submit()} className={`h-[50px] items-center justify-center rounded-lg ${canSubmit || busy ? "bg-lime-500 active:opacity-80" : "bg-bg-mute"}`}>
            {busy ? <ActivityIndicator color="#0A0A0B" /> : <Text className={`font-sans-semibold text-[15px] ${canSubmit ? "text-ink-950" : "text-fg-3"}`}>{amountValid ? `Pagar ${formatPriceArs(amount)}` : "Pagar"}</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <BottomSheetModal visible={visible} onRequestClose={() => { if (!busy) onClose(); }} onClosed={() => { if (addAfterClose) { setAddAfterClose(false); router.push("/profile/payments/add-card"); } }} testID="balance-pay-sheet" backdropTestID="balance-pay-backdrop" avoidKeyboard sheetClassName="rounded-t-2xl bg-bg px-5 pt-5">
      {body}
    </BottomSheetModal>
  );
}
