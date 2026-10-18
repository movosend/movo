import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Clock, CreditCard, Lock, RotateCcw, ShieldCheck, XCircle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PayAddCardModal } from "../../../../components/payments/pay-add-card-modal";
import { PayCardRow } from "../../../../components/payments/pay-card-row";
import { ReserveStamp } from "../../../../components/payments/reserve-stamp";
import { SkeletonBlock } from "../../../../components/ui/skeleton-block";
import { usePublicProfile } from "../../../../src/hooks/use-profile";
import { useSavedCards } from "../../../../src/hooks/use-saved-cards";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { usePayShipment, useShipmentFunding } from "../../../../src/hooks/use-shipment-funding";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { activeShipmentDisplayCode } from "../../../../src/lib/active-shipment-format";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import { type PayShipmentOutcome, tokenizeSavedCard } from "../../../../src/lib/pay-shipment-flow";
import {
  type PayFailureCopy,
  cvvLengthFor,
  defaultPayableCard,
  formatPayTimeLeft,
  payErrorMessage,
  rejectionCopy,
  shouldReconcileAfterPayError,
  unavailableKind,
} from "../../../../src/lib/pay-shipment-format";
import { cardTitle, isCardExpired } from "../../../../src/lib/saved-cards";
import { formatPriceArs } from "../../../../src/lib/shipment-format";
import {
  PAY_DEMO_CARDS,
  PAY_DEMO_SHIPMENT,
  type PayDemoScenario,
  payDemoFunding,
  payDemoOutcome,
} from "../../../../src/dev/pay-demo-fixtures";

/**
 * Pago del envío con una tarjeta guardada + código de seguridad (MOVO-269, ADR-039), fiel al
 * prototipo de Claude Design "MOVO-269 Pago con tarjeta v3". Es una **reserva de fondos, no un
 * cobro**: el monto se retiene y se cobra recién cuando se entrega el paquete.
 *
 * Los dos momentos en que aparece: tras aceptar una oferta con retiro cercano
 * (`assignment_pending`) y, para un retiro lejano, cuando el emisor confirma el pago desde el
 * detalle (`assigned_unfunded`). El token se genera en el dispositivo con la `public_key` del
 * transportista; el código de seguridad no pasa por el backend, no se guarda ni se loguea, y se
 * limpia al fallar, al cambiar de tarjeta y al salir.
 *
 * `?resumed=1`: el emisor volvió a retomar un pago que dejó a medias (AC7).
 * `?demo=form|resumed|empty|expired` (solo `__DEV__`, desde los atajos de desarrollo): datos de
 * prueba y un resultado simulado según el CVV, sin tocar el backend.
 */

type Phase = "form" | "paying" | "reserved" | "pending";

export default function PayShipmentScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ id: string; resumed?: string; demo?: string }>();
  const { id } = params;
  const demo = __DEV__ && params.demo ? (params.demo as PayDemoScenario) : null;
  const resumed = params.resumed === "1" || demo === "resumed" ? "1" : undefined;
  const realShipment = useShipment(demo ? undefined : id);
  const realFunding = useShipmentFunding(demo ? undefined : id);
  const realCards = useSavedCards();
  // En demo se pisan los tres con datos de prueba (y las consultas reales quedan apagadas).
  const shipment = demo ? PAY_DEMO_SHIPMENT : realShipment.data;
  const funding = demo
    ? {
        data: demo === "expired" ? undefined : payDemoFunding(),
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: async () => undefined,
      }
    : realFunding;
  const cardsQuery = demo
    ? {
        data: demo === "empty" ? [] : PAY_DEMO_CARDS,
        isLoading: false,
        isError: false,
        error: null,
        refetch: async () => undefined,
      }
    : realCards;
  const carrierProfile = usePublicProfile(shipment?.carrierId ?? undefined);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cvv, setCvv] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [failure, setFailure] = useState<PayFailureCopy | null>(null);
  const [expired, setExpired] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [reservedWith, setReservedWith] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const cards = cardsQuery.data;
  const selectedCard: SavedCard | null =
    (selectedId ? cards?.find((c) => c.id === selectedId && !isCardExpired(c)) : null) ??
    (cards ? defaultPayableCard(cards) : null);

  // Reloj para el "Quedan X h": una vez por minuto alcanza.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const pay = usePayShipment({
    onSettled: (outcome) => handleOutcome(outcome),
  });

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/(app)/shipments/${id}` as never);
  };

  const goToDetail = () => {
    if (demo) {
      handleBack();
      return;
    }
    // Vuelve al detalle que ya está en la pila en vez de apilar otra copia (MOVO-271 AC4).
    router.dismissTo(`/(app)/shipments/${id}` as never);
  };

  function handleOutcome(outcome: PayShipmentOutcome) {
    setCvv("");
    switch (outcome.kind) {
      case "reserved":
        setFailure(null);
        setPhase("reserved");
        return;
      case "pending":
        setFailure(null);
        setPhase("pending");
        return;
      case "unavailable":
        setExpired(true);
        setPhase("form");
        return;
      case "amount_changed":
        setFailure({
          title: "Cambió el monto a reservar",
          body: "Revisá el total actualizado y volvé a confirmar el pago. No se retuvo nada en tu tarjeta.",
          field: null,
          suggestOtherCard: false,
        });
        setPhase("form");
        void funding.refetch();
        return;
      case "rejected": {
        const amount = formatPriceArs(funding.data?.amountArs ?? null);
        setFailure(rejectionCopy(outcome.reason, amount, selectedCard ? cardTitle(selectedCard) : "tarjeta"));
        setPhase("form");
        return;
      }
      case "token_error":
        setFailure(payErrorMessage(outcome));
        setPhase("form");
        return;
      case "error":
        if (outcome.error instanceof ApiError && outcome.error.code === "SAVED_CARD_NOT_FOUND") {
          void cardsQuery.refetch();
        }
        // Monto, transportista o plazo pueden estar viejos (HOLD_CONFLICT, timeout, 5xx): se
        // vuelve a pedir el pago; si el envío ya no es pagable, la pantalla pasa sola a su vista.
        if (shouldReconcileAfterPayError(outcome)) void funding.refetch();
        setFailure(payErrorMessage(outcome));
        setPhase("form");
        return;
    }
  }

  const submit = async () => {
    if (phase === "paying" || pay.isPending || !funding.data || !selectedCard) return;
    if (cvv.length !== cvvLengthFor(selectedCard)) return;
    setFailure(null);
    setPhase("paying");
    if (selectedCard) setReservedWith(cardTitle(selectedCard));
    if (demo) {
      // Simula la espera de MP y resuelve según el CVV (ver `payDemoOutcome`).
      const typed = cvv;
      setTimeout(() => handleOutcome(payDemoOutcome(typed)), 1500);
      return;
    }
    // El CVV se usa solo acá: se tokeniza antes de la mutación para que React Query no lo retenga.
    const tokenized = await tokenizeSavedCard({ funding: funding.data, card: selectedCard, cvv });
    if (tokenized.kind !== "token") {
      handleOutcome(tokenized);
      return;
    }
    pay.mutate({
      shipmentId: funding.data.shipmentId,
      cardToken: tokenized.cardToken,
      savedCardId: selectedCard.id,
      expectedTotalArs: funding.data.totalArs,
    });
  };

  const selectCard = (card: SavedCard) => {
    if (card.id === selectedCard?.id) return;
    setSelectedId(card.id);
    setCvv("");
    setFailure(null);
    setJustAdded(false);
  };

  const handleCardSaved = (card: SavedCard) => {
    // El token de alta es de la `public_key` de Movo y no sirve para pagar al transportista:
    // se elige la tarjeta nueva y se vuelve a pedir el código (AC5).
    setAddOpen(false);
    setSelectedId(card.id);
    setCvv("");
    setFailure(null);
    setJustAdded(true);
  };

  const fundingError = funding.isError ? funding.error : null;
  const fundingUnavailable =
    expired ||
    demo === "expired" || (fundingError instanceof ApiError && fundingError.code === "SHIPMENT_FUNDING_NOT_AVAILABLE");
  const amountLabel = formatPriceArs(funding.data?.amountArs ?? null);
  const code = activeShipmentDisplayCode(id ?? "");
  const timeLeft = formatPayTimeLeft(funding.data?.payUntil, now);
  const carrierName = carrierProfile.data?.fullName.split(" ")[0] ?? "el transportista";
  const busy = phase === "paying";
  const ready = !!selectedCard && cvv.length === cvvLengthFor(selectedCard) && !failure?.field;

  const header = (title: string, right?: { amount: string; sub: string | null }) => (
    <View className="flex-row items-center gap-3 border-b border-border px-5 pb-3.5 pt-1.5">
      <Pressable
        testID="pay-back"
        accessibilityRole="button"
        accessibilityLabel="Volver"
        onPress={handleBack}
        disabled={busy}
        className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
      >
        <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
      </Pressable>
      <View className="min-w-0 flex-1">
        <Text className="font-sans-semibold text-[17px] text-fg">{title}</Text>
        <Text className="mt-0.5 font-sans text-[10px] uppercase tracking-[0.6px] text-fg-3">{code}</Text>
      </View>
      {right ? (
        <View className="items-end">
          <Text testID="pay-amount" className="font-sans-semibold text-[15px] tracking-[-0.2px] text-fg">
            {right.amount}
          </Text>
          {right.sub ? (
            <Text testID="pay-time-left" className="mt-px font-sans text-[10.5px] text-fg-3">
              {right.sub}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  // Plazo vencido o el envío ya no se puede pagar (AC7): ve lo que pasó con el envío.
  if (fundingUnavailable) {
    const kind = unavailableKind(shipment?.status);
    const copy = {
      released: {
        title: "El envío volvió a publicarse",
        body: `No confirmaste el pago a tiempo, así que liberamos a ${carrierName} y tu envío vuelve a recibir ofertas.`,
        reassure: "No retuvimos ni cobramos nada en tu tarjeta.",
      },
      already_funded: {
        title: "Este envío ya está pago",
        body: "Los fondos ya están reservados. No hace falta que pagues de nuevo.",
        reassure: "No se cobró nada de más.",
      },
      unavailable: {
        title: "Todavía no se puede pagar este envío",
        body: "El pago se habilita cuando se acerca la fecha de retiro. Te avisamos con una notificación.",
        reassure: "No retuvimos ni cobramos nada en tu tarjeta.",
      },
    }[kind];
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        {header("Confirmar pago")}
        <View testID="pay-unavailable" className="flex-1 items-center gap-3 px-6 pt-16">
          <View className="mb-2 h-16 w-16 items-center justify-center rounded-2xl bg-bg-mute">
            <Clock size={28} color={colors.fg3} strokeWidth={1.8} />
          </View>
          <Text className="text-center font-sans-semibold text-[17px] text-fg">{copy.title}</Text>
          <Text className="max-w-[290px] text-center font-sans text-[13px] leading-5 text-fg-3">{copy.body}</Text>
          <View className="mt-3 w-full flex-row items-start gap-2.5 rounded-xl bg-bg-mute p-3.5">
            <ShieldCheck size={16} color="#1F9760" strokeWidth={2.2} style={{ marginTop: 1 }} />
            <Text className="flex-1 font-sans text-[12.5px] leading-[18px] text-fg-2">{copy.reassure}</Text>
          </View>
        </View>
        <View className="border-t border-border px-5 pb-6 pt-3.5">
          <Pressable
            testID="pay-unavailable-cta"
            accessibilityRole="button"
            onPress={goToDetail}
            className="h-12 items-center justify-center rounded-lg bg-fg active:opacity-80"
          >
            <Text className="font-sans-semibold text-[15px] text-bg">Ver el detalle del envío</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Reserva exitosa (o en proceso): el sello lima y el resumen.
  if (phase === "reserved" || phase === "pending") {
    const done = phase === "reserved";
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        {header(done ? "Pago confirmado" : "Pago en proceso", { amount: amountLabel, sub: done ? "Retenido" : null })}
        <ScrollView contentContainerClassName="gap-4 px-5 pb-4 pt-6">
          <View testID={done ? "pay-reserved" : "pay-pending"} className="items-center gap-1.5">
            <View className="pb-2 pt-6">
              {done ? <ReserveStamp testID="pay-reserved-stamp" /> : <ActivityIndicator size="large" color={colors.fg2} />}
            </View>
            <Text className="text-center font-sans-semibold text-[24px] leading-[29px] tracking-[-0.4px] text-fg">
              {done ? "Fondos reservados" : "Estamos confirmando tu reserva"}
            </Text>
            <Text className="max-w-[320px] text-center font-sans text-[14px] leading-[21px] text-fg-2">
              {done
                ? `Retuvimos ${amountLabel} en tu ${reservedWith ?? "tarjeta"}. No se cobró nada: el cobro se hace recién cuando ${carrierName} entregue el paquete.`
                : "Mercado Pago todavía no confirmó la reserva. No se cobró nada. Te avisamos apenas esté lista; podés cerrar esta pantalla."}
            </Text>
          </View>
          {done ? (
            <View className="mt-2 rounded-[10px] border border-border bg-bg-sub px-3.5">
              <SummaryRow label="Envío" value={code} mono />
              <SummaryRow label="Tarjeta" value={reservedWith ?? "—"} />
              <SummaryRow label="Se cobra" value="Al entregar el paquete" last />
            </View>
          ) : null}
        </ScrollView>
        <View className="border-t border-border px-5 pb-6 pt-3.5">
          <Pressable
            testID="pay-done-cta"
            accessibilityRole="button"
            onPress={goToDetail}
            className="h-[52px] items-center justify-center rounded-lg bg-fg active:opacity-80"
          >
            <Text className="font-sans-semibold text-[15px] text-bg">Volver al detalle del envío</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const loadingAny = funding.isLoading || cardsQuery.isLoading;
  const loadError = funding.isError ? funding.error : cardsQuery.isError && !cards ? cardsQuery.error : null;
  const hasCards = !!cards && cards.length > 0;
  const primaryLabel = busy ? "Reservando…" : `Reservar ${amountLabel}`;
  const primaryDisabled = busy || !ready || !funding.data || funding.isFetching || funding.isError;
  const cvvError = failure?.field === "cvv";

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      {header("Confirmar pago", funding.data ? { amount: amountLabel, sub: timeLeft } : undefined)}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView
          testID="pay-scroll"
          className="flex-1"
          contentContainerClassName="gap-4 px-5 pb-4 pt-[22px]"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {resumed === "1" ? (
            <View testID="pay-resumed" className="flex-row items-start gap-2.5 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3">
              <RotateCcw size={16} color={colors.fg2} strokeWidth={2} style={{ marginTop: 1 }} />
              <Text className="flex-1 font-sans text-[12.5px] leading-[18px] text-fg-2">
                <Text className="font-sans-semibold text-fg">Retomaste tu pago.</Text> Todavía estás a tiempo. Por seguridad,
                volvé a escribir el código de seguridad.
              </Text>
            </View>
          ) : null}

          {justAdded && !failure ? (
            <View testID="pay-just-added" className="flex-row items-start gap-2.5 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3">
              <ShieldCheck size={16} color="#1F9760" strokeWidth={2.2} style={{ marginTop: 1 }} />
              <Text className="flex-1 font-sans text-[12.5px] leading-[18px] text-fg-2">
                <Text className="font-sans-semibold text-fg">Guardamos tu tarjeta.</Text> Para pagar, escribí de nuevo el código
                de seguridad: el que usaste al agregarla no sirve para este pago.
              </Text>
            </View>
          ) : null}

          {failure ? (
            <View
              testID="pay-failure"
              accessibilityLiveRegion="polite"
              className="flex-row items-start gap-2.5 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
            >
              <XCircle size={16} color="#C22F35" strokeWidth={2} style={{ marginTop: 1 }} />
              <View className="flex-1">
                <Text className="font-sans-semibold text-[13px] text-ink-950">{failure.title}</Text>
                <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-ink-950">{failure.body}</Text>
              </View>
            </View>
          ) : null}

          {funding.data && funding.data.pendingBalanceArs > 0 ? (
            <View testID="pay-debt-breakdown" className="gap-2">
              <View className="overflow-hidden rounded-lg border border-border">
                <View className="flex-row items-center justify-between bg-bg-mute px-3.5 py-3.5">
                  <Text className="font-sans text-[14px] text-fg-2">Precio del envío</Text>
                  <Text className="font-sans-semibold text-[16px] text-fg">{formatPriceArs(funding.data.priceArs)}</Text>
                </View>
                <View className="flex-row items-start justify-between gap-3 px-3.5 py-3.5">
                  <View className="flex-1">
                    <Text className="font-sans text-[14px] text-fg-2">Saldo pendiente</Text>
                    <Text className="mt-0.5 font-sans text-[12px] leading-[17px] text-fg-3">
                      De tu cuenta corriente. Se cobra hasta un tope por envío; el resto queda para el próximo.
                    </Text>
                  </View>
                  <Text className="font-sans-semibold text-[16px] text-fg">+ {formatPriceArs(funding.data.pendingBalanceArs)}</Text>
                </View>
                <View className="flex-row items-center justify-between bg-lime-500 px-3.5 py-4">
                  <Text className="font-sans-semibold text-[12px] uppercase tracking-wider text-ink-950">Total a reservar</Text>
                  <Text className="font-sans-semibold text-[24px] text-ink-950">{formatPriceArs(funding.data.totalArs)}</Text>
                </View>
              </View>
              <Text className="px-0.5 font-sans text-[12px] text-fg-3">
                {formatPriceArs(funding.data.priceArs)} + saldo {formatPriceArs(funding.data.pendingBalanceArs)} ={" "}
                {formatPriceArs(funding.data.totalArs)}
              </Text>
            </View>
          ) : null}

          <View className="gap-1">
            <Text className="font-sans-semibold text-[20px] tracking-[-0.3px] text-fg">¿Con qué tarjeta pagás?</Text>
            <Text className="font-sans text-[13px] leading-[18px] text-fg-3">
              {hasCards
                ? "Te marcamos tu predeterminada. Solo falta el código de seguridad."
                : "Necesitás una tarjeta para reservar el pago."}
            </Text>
          </View>

          {loadingAny ? (
            <View testID="pay-loading" className="gap-2">
              <SkeletonBlock className="h-[68px] w-full rounded-[10px]" />
              <SkeletonBlock className="h-[68px] w-full rounded-[10px]" />
            </View>
          ) : loadError ? (
            <View testID="pay-load-error" className="gap-3 rounded-[10px] border border-danger-300 bg-danger-100 p-3.5">
              <Text className="font-sans text-[13px] leading-[18px] text-ink-950">
                {friendlyErrorMessage(loadError, "No pudimos cargar los datos del pago. Probá de nuevo.")}
              </Text>
              <Pressable
                testID="pay-retry"
                accessibilityRole="button"
                onPress={() => {
                  void funding.refetch();
                  void cardsQuery.refetch();
                }}
                className="h-10 items-center justify-center rounded-lg bg-fg active:opacity-80"
              >
                <Text className="font-sans-semibold text-[14px] text-bg">Reintentar</Text>
              </Pressable>
            </View>
          ) : !hasCards ? (
            <View
              testID="pay-empty"
              className="items-center gap-2 rounded-2xl border border-border bg-bg-sub px-4 pb-4 pt-6"
            >
              <View className="mb-1 h-12 w-12 items-center justify-center rounded-xl border border-border bg-bg">
                <CreditCard size={22} color={colors.fg2} strokeWidth={1.8} />
              </View>
              <Text className="font-sans-semibold text-[15px] text-fg">Todavía no guardaste tarjetas</Text>
              <Text className="max-w-[260px] text-center font-sans text-[13px] leading-[18px] text-fg-3">
                Agregala una vez y queda guardada para tus próximos envíos.
              </Text>
              <Pressable
                testID="pay-empty-add"
                accessibilityRole="button"
                onPress={() => setAddOpen(true)}
                className="mt-2 w-full items-center rounded-full bg-fg py-3 active:opacity-80"
              >
                <Text className="font-sans-semibold text-[14px] text-bg">Agregar tarjeta</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View className="gap-2">
                {sortedCards(cards).map((card) => (
                  <PayCardRow
                    key={card.id}
                    card={card}
                    selected={card.id === selectedCard?.id}
                    locked={busy}
                    cvv={card.id === selectedCard?.id ? cvv : ""}
                    cvvError={cvvError && card.id === selectedCard?.id}
                    onSelect={() => selectCard(card)}
                    onCvvChange={(value) => {
                      setCvv(value);
                      if (failure) setFailure(null);
                    }}
                    onSubmit={submit}
                  />
                ))}
                <Pressable
                  testID="pay-add-card"
                  accessibilityRole="button"
                  accessibilityLabel="Agregar tarjeta nueva"
                  onPress={() => setAddOpen(true)}
                  disabled={busy}
                  className="flex-row items-center gap-3 rounded-[10px] p-3.5 active:bg-bg-sub"
                  style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.borderStrong }}
                >
                  <Text className="w-5 text-center font-sans-semibold text-[16px] text-fg">+</Text>
                  <Text className="flex-1 font-sans-semibold text-[15px] text-fg">Agregar tarjeta nueva</Text>
                </Pressable>
              </View>

              <View className="flex-row items-start gap-2 px-0.5">
                <Lock size={14} color={colors.fg2} strokeWidth={2} style={{ marginTop: 2 }} />
                <Text className="flex-1 font-sans text-[12.5px] leading-[18px] text-fg-2">
                  Vamos a <Text className="font-sans-semibold text-fg">retener</Text> {amountLabel}. Se cobra recién cuando el
                  paquete se entrega.
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        <View className="gap-2.5 bg-bg px-5 pb-3 pt-3">
          <View className="flex-row items-center justify-center gap-1.5">
            <ShieldCheck size={12} color={colors.fg3} strokeWidth={2.2} />
            <Text className="font-sans text-[11px] text-fg-3">El código no se guarda: te lo pedimos en cada pago.</Text>
          </View>
          <Pressable
            testID="pay-submit"
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            accessibilityState={{ disabled: primaryDisabled, busy }}
            onPress={submit}
            disabled={primaryDisabled}
            className={`h-[52px] flex-row items-center justify-center gap-2 rounded-lg ${
              primaryDisabled ? "bg-bg-mute" : "bg-fg active:opacity-80"
            }`}
          >
            {busy ? <ActivityIndicator testID="pay-spinner" size="small" color={colors.fg2} /> : null}
            <Text className={`font-sans-semibold text-[15px] ${primaryDisabled ? "text-fg-3" : "text-bg"}`}>{primaryLabel}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <PayAddCardModal visible={addOpen} cards={cards} onClose={() => setAddOpen(false)} onSaved={handleCardSaved} />
    </SafeAreaView>
  );
}

function sortedCards(cards: SavedCard[]): SavedCard[] {
  // La predeterminada primero y las vencidas al final, como el resto de las listas de tarjetas.
  return [...cards].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) || Number(isCardExpired(a)) - Number(isCardExpired(b)),
  );
}

function SummaryRow({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <View className={`flex-row items-center justify-between py-3 ${last ? "" : "border-b border-border"}`}>
      <Text className="font-sans text-[12px] text-fg-3">{label}</Text>
      <Text className={`${mono ? "font-mono-medium" : "font-sans-medium"} text-[13px] text-fg`}>{value}</Text>
    </View>
  );
}
