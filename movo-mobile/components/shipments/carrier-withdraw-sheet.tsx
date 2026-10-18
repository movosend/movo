import { ApiError } from "@movo/shared/dist/errors/api-error";
import { AlertCircle, AlertTriangle } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useCarrierWithdraw, useCarrierWithdrawalQuote } from "../../src/hooks/use-shipments";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  carrierDebtNotice,
  carrierWithdrawalQuoteView,
  type CarrierWithdrawalQuoteView,
} from "../../src/lib/cancellation-format";
import { formatSettlementAmount } from "../../src/lib/settlement-format";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { MismatchNotice } from "./cancel-shipment-sheet";

type Phase = "loading" | "quoteError" | "quote" | "blocked";

/** 409 de estado (o envío que ya no es suyo): ya no puede bajarse. */
const BLOCKING_CODES = new Set([
  "SHIPMENT_INVALID_TRANSITION",
  "SHIPMENT_CONCURRENT_MODIFICATION",
  "AUTH_FORBIDDEN",
  "NOT_FOUND",
]);

function isBlockingError(err: unknown): boolean {
  return err instanceof ApiError && BLOCKING_CODES.has(err.code);
}

export interface CarrierWithdrawSheetProps {
  visible: boolean;
  shipmentId: string;
  /** Nombre de pila del emisor, para el copy ("Lucía ya contaba con vos"). */
  senderFirstName?: string | null;
  onClose: () => void;
  /** La baja salió: la pantalla cierra el sheet, sale del detalle y muestra la confirmación. */
  onWithdrawn: (message: string) => void;
  /** Refresca lo que el transportista ve ante un 409 de estado. */
  onRefetch?: () => void;
  testID?: string;
}

/**
 * Sheet "No puedo hacer este envío" (MOVO-314, ADR-047), réplica del prototipo "MOVO-314
 * Transportista se baja" de Claude Design. Antes de confirmar pide la cotización de la baja: sin
 * cargo, o la deuda que se le registra en la cuenta corriente (menos de 12 h para el retiro).
 *
 * - La confirmación manda `expectedPenaltyArs`. Ante 409 `CANCELLATION_PENALTY_MISMATCH` se
 *   vuelve a cotizar y se avisa que el monto cambió; el transportista confirma de nuevo.
 * - Ante un 409 de estado se refresca y el sheet explica que ya no se puede.
 * - Mientras se confirma no se puede cerrar.
 */
export function CarrierWithdrawSheet({
  visible,
  shipmentId,
  senderFirstName,
  onClose,
  onWithdrawn,
  onRefetch,
  testID = "carrier-withdraw-sheet",
}: CarrierWithdrawSheetProps) {
  const colors = useThemeColors();
  const quoteMutation = useCarrierWithdrawalQuote();
  const withdrawMutation = useCarrierWithdraw();

  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<CarrierWithdrawalQuoteView | null>(null);
  const [penaltyArs, setPenaltyArs] = useState(0);
  const [previousPenaltyArs, setPreviousPenaltyArs] = useState<number | null>(null);
  const [confirmError, setConfirmError] = useState(false);
  const [isRequoting, setIsRequoting] = useState(false);

  // Una respuesta que llega con el sheet ya cerrado (o reabierto) no pisa el estado nuevo.
  const sessionRef = useRef(0);
  const isConfirming = withdrawMutation.isPending || isRequoting;
  const senderName = senderFirstName || "el emisor";

  const goBlocked = (session: number) => {
    if (session !== sessionRef.current) return;
    onRefetch?.();
    setPhase("blocked");
  };

  /** `previous`: la penalidad que el transportista había visto, cuando se re-cotiza por un 409 de monto. */
  const fetchQuote = async (session: number, previous?: number) => {
    try {
      const quote = await quoteMutation.mutateAsync(shipmentId);
      if (session !== sessionRef.current) return;
      setView(carrierWithdrawalQuoteView(quote));
      setPenaltyArs(quote.penaltyArs);
      if (previous !== undefined) setPreviousPenaltyArs(previous);
      setPhase("quote");
    } catch (err) {
      if (session !== sessionRef.current) return;
      if (isBlockingError(err)) {
        goBlocked(session);
        return;
      }
      setPhase("quoteError");
    }
  };

  useEffect(() => {
    if (!visible) return;
    const session = ++sessionRef.current;
    setConfirmError(false);
    setPreviousPenaltyArs(null);
    setPenaltyArs(0);
    setView(null);
    setPhase("loading");
    void fetchQuote(session);
    // Solo al abrir: re-cotizar en cada render pisaría lo que el transportista está leyendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
      await withdrawMutation.mutateAsync({ id: shipmentId, expectedPenaltyArs: penaltyArs });
      if (session !== sessionRef.current) return;
      onWithdrawn(
        penaltyArs > 0
          ? `Cancelaste el envío. Registramos una deuda de ${formatSettlementAmount(penaltyArs)}.`
          : "Cancelaste el envío. Ya no está en tu viaje.",
      );
    } catch (err) {
      if (session !== sessionRef.current) return;
      if (err instanceof ApiError && err.code === "CANCELLATION_PENALTY_MISMATCH") {
        setIsRequoting(true);
        await fetchQuote(session, penaltyArs);
        setIsRequoting(false);
        return;
      }
      if (isBlockingError(err)) {
        goBlocked(session);
        return;
      }
      setConfirmError(true);
    }
  };

  const id = (suffix: string) => `${testID}-${suffix}`;
  const isDebt = view?.kind === "debt";
  const senderNameCapitalized = senderName.charAt(0).toUpperCase() + senderName.slice(1);

  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={handleClose}
      testID={testID}
      backdropTestID={id("backdrop")}
      backdropClassName="bg-black/50"
      sheetClassName="rounded-t-[24px] border-t border-border bg-bg px-5 pt-5"
      contentClassName="gap-4"
    >
      {phase === "loading" ? (
        <View testID={id("loading")} className="items-center gap-3.5 pb-9 pt-7">
          <ActivityIndicator color={colors.fg1} />
          <View className="items-center gap-0.5">
            <Text className="font-sans-semibold text-[15px] leading-5 text-fg">Calculando si tiene cargo</Text>
            <Text className="font-sans text-small text-fg-3">Revisamos cuánto falta para el retiro.</Text>
          </View>
        </View>
      ) : null}

      {phase === "quoteError" ? (
        <>
          <Text className="font-sans-semibold text-h3 text-fg">¿Cancelar este envío?</Text>
          <View
            testID={id("quote-error")}
            className="flex-row gap-2.5 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
          >
            <AlertCircle size={16} color="#972327" strokeWidth={2} style={{ marginTop: 1 }} />
            <Text className="flex-1 font-sans text-[13px] leading-[18px] text-ink-950">
              No pudimos calcular si tiene cargo. Probá de nuevo.
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
          <Text className="font-sans-semibold text-h3 text-fg">Ya no podés bajarte de este envío</Text>
          <Text testID={id("blocked-text")} className="font-sans text-small leading-5 text-fg-2">
            El estado del envío cambió. Si ya lo retiraste o hay un problema, escribile a {senderName} por el chat del
            envío.
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
          <Text className="font-sans-semibold text-h3 text-fg">¿Cancelar este envío?</Text>

          {previousPenaltyArs !== null ? (
            <MismatchNotice previous={previousPenaltyArs} next={penaltyArs} testID={id("mismatch")} />
          ) : null}

          {view.kind === "free" ? (
            <Text testID={id("free")} className="font-sans text-small leading-5 text-fg-2">
              No tiene ningún cargo. Le avisamos a {senderName} y el envío vuelve a publicarse para otros transportistas.
            </Text>
          ) : (
            <>
              <Text testID={id("debt-lead")} className="font-sans text-small leading-5 text-fg-2">
                Faltan menos de 12 h para el retiro. {senderNameCapitalized} ya contaba con vos.
              </Text>
              <View className="flex-row gap-3 rounded-[10px] border border-warning-300 bg-warning-100 p-3.5">
                <AlertTriangle size={16} color="#A97714" strokeWidth={2} style={{ marginTop: 2 }} />
                <Text testID={id("debt")} className="flex-1 font-sans text-[13px] leading-[19px] text-ink-950">
                  {carrierDebtNotice(view.penaltyArs)}
                </Text>
              </View>
            </>
          )}

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
              className={`h-12 items-center justify-center rounded-[12px] ${isDebt ? "bg-danger-500" : "bg-fg"} ${
                isConfirming ? "opacity-70" : ""
              }`}
            >
              {isConfirming ? (
                <ActivityIndicator testID={id("confirming")} size="small" color="#FFFFFF" />
              ) : (
                <Text className={`font-sans-semibold text-small ${isDebt ? "text-white" : "text-bg"}`}>
                  {isDebt ? "Cancelar igual" : "Cancelar el envío"}
                </Text>
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
