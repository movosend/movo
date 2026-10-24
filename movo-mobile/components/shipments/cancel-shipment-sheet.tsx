import type { CancellationQuoteResponse } from "@movo/shared/dist/config/cancellation-penalty";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { AlertCircle, AlertTriangle, Info } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useCancelShipment, useCancellationQuote } from "../../src/hooks/use-shipments";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  cancellationQuoteView,
  penaltyMismatchNotice,
  type CancellationQuoteView,
} from "../../src/lib/cancellation-format";
import { formatSettlementAmount } from "../../src/lib/settlement-format";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { TextField } from "../ui/text-field";

type Phase = "loading" | "quoteError" | "quote" | "blocked";

/** 409 de estado: el envío ya no se puede cancelar (lo retiraron, venció, cambió de estado). */
const BLOCKING_CODES = new Set(["SHIPMENT_INVALID_TRANSITION", "SHIPMENT_CONCURRENT_MODIFICATION"]);

/** Estados en los que el transportista ya tiene el paquete: ahí el bloqueo se explica por el retiro. */
const PICKED_UP_STATUSES: readonly ShipmentStatus[] = [
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.COMPLETED,
  ShipmentStatus.DISPUTED,
];

function isBlockingError(err: unknown): boolean {
  return err instanceof ApiError && BLOCKING_CODES.has(err.code);
}

export interface CancelShipmentSheetProps {
  visible: boolean;
  shipment: Pick<ShipmentSummary, "id" | "status" | "agreedPriceArs">;
  /** Monto real reservado en el hold (incluye deuda cobrada en MOVO-311); cae a `agreedPriceArs` si no cargó. */
  holdAmountArs?: number | null;
  /** Nombre de pila del transportista asignado, si hay. */
  carrierFirstName?: string | null;
  onClose: () => void;
  /** La cancelación salió: la pantalla cierra el sheet y muestra la confirmación. */
  onCancelled: (message: string) => void;
  /** Refresca el detalle ante un 409 de estado y devuelve el estado nuevo (para explicar el bloqueo). */
  onRefetch: () => Promise<ShipmentStatus | undefined>;
  testID?: string;
}

/**
 * Sheet de cancelación del emisor (MOVO-308, ADR-047), réplica del prototipo "MOVO-308 Emisor
 * cancela" de Claude Design. Un envío `assigned` tiene la tarjeta reservada: antes de confirmar
 * se pide la cotización y el sheet muestra si cancelar tiene cargo (sin cargo hasta el plazo,
 * penalidad, o franja de retiro vencida). Los estados sin reserva no cotizan.
 *
 * - La confirmación manda `expectedPenaltyArs`. Ante 409 `CANCELLATION_PENALTY_MISMATCH` se
 *   vuelve a cotizar y se avisa que el monto cambió (AC3); el emisor confirma de nuevo.
 * - Ante un 409 de estado (al cotizar o al confirmar) se refresca el detalle y el sheet explica
 *   que ya no se puede cancelar.
 * - Mientras se confirma no se puede cerrar.
 */
export function CancelShipmentSheet({
  visible,
  shipment,
  holdAmountArs,
  carrierFirstName,
  onClose,
  onCancelled,
  onRefetch,
  testID = "cancel-shipment-sheet",
}: CancelShipmentSheetProps) {
  const colors = useThemeColors();
  const quoteMutation = useCancellationQuote();
  const cancelMutation = useCancelShipment();

  const [phase, setPhase] = useState<Phase>("loading");
  const [quote, setQuote] = useState<CancellationQuoteResponse | null>(null);
  const [penaltyArs, setPenaltyArs] = useState(0);
  const [previousPenaltyArs, setPreviousPenaltyArs] = useState<number | null>(null);
  const [confirmError, setConfirmError] = useState(false);
  const [blockedText, setBlockedText] = useState("");
  const [reason, setReason] = useState("");
  const [isRequoting, setIsRequoting] = useState(false);

  // Una respuesta que llega con el sheet ya cerrado (o reabierto) no pisa el estado nuevo.
  const sessionRef = useRef(0);
  const hasHold = shipment.status === ShipmentStatus.ASSIGNED;
  const isConfirming = cancelMutation.isPending || isRequoting;
  const carrierName = carrierFirstName || "el transportista";
  const view: CancellationQuoteView | null =
    phase !== "quote"
      ? null
      : quote
        ? cancellationQuoteView(quote, shipment.agreedPriceArs, holdAmountArs)
        : { kind: "noHold" };

  const goBlocked = async (session: number) => {
    const status = await onRefetch().catch(() => undefined);
    if (session !== sessionRef.current) return;
    setBlockedText(
      status !== undefined && PICKED_UP_STATUSES.includes(status)
        ? `${carrierFirstName || "El transportista"} ya retiró el paquete. Si hay un problema, escribile por el chat del envío.`
        : "El estado del envío cambió y ya no se puede cancelar.",
    );
    setPhase("blocked");
  };

  /** `previous`: la penalidad que el emisor había visto, cuando se re-cotiza por un 409 de monto. */
  const fetchQuote = async (session: number, previous?: number) => {
    try {
      const nextQuote = await quoteMutation.mutateAsync(shipment.id);
      if (session !== sessionRef.current) return;
      setQuote(nextQuote);
      setPenaltyArs(nextQuote.penaltyArs);
      if (previous !== undefined) setPreviousPenaltyArs(previous);
      setPhase("quote");
    } catch (err) {
      if (session !== sessionRef.current) return;
      if (isBlockingError(err)) {
        await goBlocked(session);
        return;
      }
      setPhase("quoteError");
    }
  };

  useEffect(() => {
    if (!visible) return;
    // Con el sheet abierto el envío puede pasar de `assigned_unfunded` a `assigned` (o al revés)
    // por un refetch: ahí se vuelve a armar. Cualquier otro estado (cancelado, retirado) no
    // cambia la vista; el 409 del backend lo explica al confirmar.
    if (!hasHold && (shipment.status === ShipmentStatus.CANCELLED || PICKED_UP_STATUSES.includes(shipment.status))) return;
    const session = ++sessionRef.current;
    setReason("");
    setConfirmError(false);
    setPreviousPenaltyArs(null);
    setPenaltyArs(0);
    if (hasHold) {
      setQuote(null);
      setPhase("loading");
      void fetchQuote(session);
    } else {
      setQuote(null);
      setPhase("quote");
    }
    // Solo al abrir o si cambia la reserva: re-cotizar en cada render pisaría lo que el emisor lee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, hasHold]);

  const handleRetryQuote = () => {
    setPhase("loading");
    void fetchQuote(sessionRef.current);
  };

  const handleClose = () => {
    if (isConfirming) return;
    sessionRef.current += 1;
    onClose();
  };

  const handleConfirm = async () => {
    if (phase !== "quote" || isConfirming) return;
    const session = sessionRef.current;
    setConfirmError(false);
    try {
      await cancelMutation.mutateAsync({
        id: shipment.id,
        reason: reason.trim() || undefined,
        ...(hasHold ? { expectedPenaltyArs: penaltyArs } : {}),
      });
      if (session !== sessionRef.current) return;
      onCancelled(carrierFirstName ? `Cancelaste el envío. Le avisamos a ${carrierFirstName}.` : "Cancelaste el envío.");
    } catch (err) {
      if (session !== sessionRef.current) return;
      if (err instanceof ApiError && err.code === "CANCELLATION_PENALTY_MISMATCH") {
        setIsRequoting(true);
        await fetchQuote(session, penaltyArs);
        setIsRequoting(false);
        return;
      }
      if (isBlockingError(err)) {
        await goBlocked(session);
        return;
      }
      setConfirmError(true);
    }
  };

  const id = (suffix: string) => `${testID}-${suffix}`;
  const reserved = (value: number | null) => (value === null ? "lo reservado" : `los ${formatSettlementAmount(value)} reservados`);

  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={handleClose}
      testID={testID}
      backdropTestID={id("backdrop")}
      backdropClassName="bg-black/50"
      sheetClassName="rounded-t-[24px] border-t border-border bg-bg px-5 pt-5"
      contentClassName="gap-4"
      avoidKeyboard
    >
      {phase === "loading" ? (
        <View testID={id("loading")} className="items-center gap-3.5 pb-9 pt-7">
          <ActivityIndicator color={colors.fg1} />
          <View className="items-center gap-0.5">
            <Text className="font-sans-semibold text-[15px] leading-5 text-fg">Calculando si tiene cargo</Text>
            <Text className="font-sans text-small text-fg-3">Revisamos el plazo y lo que reservaste.</Text>
          </View>
        </View>
      ) : null}

      {phase === "quoteError" ? (
        <>
          <Text className="font-sans-semibold text-h3 text-fg">¿Cancelar envío?</Text>
          <View
            testID={id("quote-error")}
            className="flex-row gap-2.5 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
          >
            <AlertCircle size={16} color="#972327" strokeWidth={2} style={{ marginTop: 1 }} />
            <Text className="flex-1 font-sans text-[13px] leading-[18px] text-ink-950">
              No pudimos calcular si la cancelación tiene cargo. Probá de nuevo.
            </Text>
          </View>
          <View className="gap-2.5 pt-2">
            <Pressable
              testID={id("retry")}
              onPress={handleRetryQuote}
              accessibilityRole="button"
              className="h-12 items-center justify-center rounded-[12px] bg-fg"
            >
              <Text className="font-sans-semibold text-small text-bg">Reintentar</Text>
            </Pressable>
            <Pressable
              testID={id("dismiss")}
              onPress={handleClose}
              accessibilityRole="button"
              className="h-11 items-center justify-center rounded-[12px]"
            >
              <Text className="font-sans-medium text-small text-fg-2">Volver</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {phase === "blocked" ? (
        <>
          <Text className="font-sans-semibold text-h3 text-fg">Ya no podés cancelar este envío</Text>
          <Text testID={id("blocked-text")} className="font-sans text-small leading-5 text-fg-2">
            {blockedText}
          </Text>
          <View className="gap-2.5 pt-2">
            <Pressable
              testID={id("blocked-ok")}
              onPress={handleClose}
              accessibilityRole="button"
              className="h-12 items-center justify-center rounded-[12px] bg-fg"
            >
              <Text className="font-sans-semibold text-small text-bg">Entendido</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {phase === "quote" && view ? (
        <>
          <Text className="font-sans-semibold text-h3 text-fg">¿Cancelar envío?</Text>

          {view.kind === "noHold" ? (
            <Text testID={id("no-hold")} className="font-sans text-small leading-5 text-fg-2">
              El envío deja de estar publicado y no se te cobra nada. Si había ofertas, le avisamos a cada transportista.
            </Text>
          ) : null}

          {view.kind === "free" ? (
            <Text testID={id("free")} className="font-sans text-small leading-5 text-fg-2">
              {view.freeUntilLabel ? (
                <>
                  Podés cancelar sin cargo hasta el{" "}
                  <Text className="font-sans-semibold text-fg">{view.freeUntilLabel}</Text>.
                </>
              ) : (
                "Podés cancelar sin cargo."
              )}{" "}
              Te liberamos {reserved(view.reservedArs)} y le avisamos a {carrierName}.
            </Text>
          ) : null}

          {view.kind === "expired" ? (
            <>
              {previousPenaltyArs !== null ? (
                <MismatchNotice previous={previousPenaltyArs} next={penaltyArs} testID={id("mismatch")} />
              ) : null}
              <Text testID={id("expired")} className="font-sans text-small leading-5 text-fg-2">
                Ya pasó el plazo para cancelar sin cargo, pero esta vez{" "}
                <Text className="font-sans-semibold text-fg">no se te cobra nada</Text>. Te liberamos{" "}
                {reserved(view.reservedArs)}.
              </Text>
              <View className="flex-row gap-2.5 rounded-[10px] border border-dashed border-border-strong bg-bg-sub px-3.5 py-3">
                <Info size={16} color={colors.fg2} strokeWidth={2} style={{ marginTop: 1 }} />
                <Text testID={id("expired-reason")} className="flex-1 font-sans text-[13px] leading-[18px] text-fg">
                  {view.reasonText}
                </Text>
              </View>
            </>
          ) : null}

          {view.kind === "penalty" ? (
            <>
              {previousPenaltyArs !== null ? (
                <MismatchNotice previous={previousPenaltyArs} next={penaltyArs} testID={id("mismatch")} />
              ) : null}
              <Text testID={id("penalty")} className="font-sans text-small leading-5 text-fg-2">
                Se te cobrará{" "}
                <Text className="font-sans-semibold text-fg">{formatSettlementAmount(view.penaltyArs)}</Text> de los{" "}
                <Text className="font-sans-semibold text-fg">{formatSettlementAmount(view.reservedArs)}</Text>{" "}
                reservados. El resto se libera en tu tarjeta.
              </Text>
              {view.reasonText ? (
                <View className="flex-row gap-2.5 rounded-[10px] border border-dashed border-border-strong bg-bg-sub px-3.5 py-3">
                  <Info size={16} color={colors.fg2} strokeWidth={2} style={{ marginTop: 1 }} />
                  <Text testID={id("penalty-reason")} className="flex-1 font-sans text-[13px] leading-[18px] text-fg">
                    {view.reasonText}
                  </Text>
                </View>
              ) : null}
              <View className="overflow-hidden rounded-[10px] border border-border">
                {/* Barra de 6 px: 14 de padding arriba + 6 de alto, como el prototipo. */}
                <View className="flex-row gap-0.5 px-3.5 pt-3.5" style={{ height: 20 }}>
                  <View className="rounded-full bg-danger-500" style={{ width: `${view.penaltyRatio * 100}%` }} />
                  <View className="flex-1 rounded-full bg-success-500" />
                </View>
                <View className="gap-2.5 px-3.5 py-3.5">
                  <View className="flex-row justify-between gap-3">
                    <Text className="font-sans text-[13px] text-fg-2">Precio reservado</Text>
                    <Text className="font-sans-semibold text-[13px] text-fg">
                      {formatSettlementAmount(view.reservedArs)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between gap-3">
                    <View className="flex-row items-center gap-1.5">
                      <View className="h-2 w-2 rounded-full bg-danger-500" />
                      <Text className="font-sans text-[13px] text-fg-2">Penalidad</Text>
                    </View>
                    <Text testID={id("penalty-amount")} className="font-sans-semibold text-[13px] text-danger-600">
                      − {formatSettlementAmount(view.penaltyArs)}
                    </Text>
                  </View>
                </View>
                <View className="flex-row items-center justify-between gap-3 bg-success-100 px-3.5 py-3">
                  <View className="flex-row items-center gap-1.5">
                    <View className="h-2 w-2 rounded-full bg-success-500" />
                    <Text className="font-sans-medium text-[13px] text-success-700">Se libera en tu tarjeta</Text>
                  </View>
                  <Text testID={id("released-amount")} className="font-sans-semibold text-[17px] text-success-700">
                    {formatSettlementAmount(view.releasedArs)}
                  </Text>
                </View>
              </View>
            </>
          ) : null}

          <TextField
            testID={id("reason-input")}
            label="Motivo de la cancelación (opcional)"
            placeholder="Ej: Me equivoqué de dirección, ya no lo necesito..."
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            containerClassName="gap-1.5"
          />

          {confirmError ? (
            <View
              testID={id("confirm-error")}
              className="rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
            >
              <Text className="font-sans text-[13px] leading-[18px] text-ink-950">
                No pudimos cancelar el envío. Probá de nuevo.
              </Text>
            </View>
          ) : null}

          <View className="gap-2.5 pt-2">
            <Pressable
              testID={id("confirm")}
              onPress={() => void handleConfirm()}
              disabled={isConfirming}
              accessibilityRole="button"
              className={`h-12 items-center justify-center rounded-[12px] bg-danger-500 ${isConfirming ? "opacity-70" : ""}`}
            >
              {isConfirming ? (
                <ActivityIndicator testID={id("confirming")} size="small" color="#FFFFFF" />
              ) : (
                <Text className="font-sans-semibold text-small text-white">Cancelar envío</Text>
              )}
            </Pressable>
            <Pressable
              testID={id("dismiss")}
              onPress={handleClose}
              disabled={isConfirming}
              accessibilityRole="button"
              className="h-11 items-center justify-center rounded-[12px]"
            >
              <Text className="font-sans-medium text-small text-fg-2">Volver</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </BottomSheetModal>
  );
}

export function MismatchNotice({ previous, next, testID }: { previous: number; next: number; testID: string }) {
  const notice = penaltyMismatchNotice(previous, next);
  return (
    <View testID={testID} className="flex-row gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3">
      <AlertTriangle size={16} color="#A97714" strokeWidth={2} style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text className="font-sans-semibold text-[13px] leading-[18px] text-ink-950">{notice.title}</Text>
        <Text testID={`${testID}-body`} className="mt-0.5 font-sans text-[12.5px] leading-[17px] text-ink-600">
          {notice.body}
        </Text>
      </View>
    </View>
  );
}
