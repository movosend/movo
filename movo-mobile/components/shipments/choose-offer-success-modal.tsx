import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import type { OfferAcceptanceAssignment } from "@movo/shared/dist/types/funding";
import { formatFundingDay } from "../../src/lib/funds-status-format";
import { formatPickupDayLabel, formatPriceArs } from "../../src/lib/shipment-format";
import { SuccessMoment } from "../ui/success-moment";
import { FundingTimeline } from "./funds-status";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** 3,5 s (MOVO-271): con 1,6 s no se llegaba a leer el texto antes del redirect. */
export const AUTO_DISMISS_MS = 3500;

export interface ChooseOfferSuccessModalProps {
  visible: boolean;
  carrierName: string | null;
  /** Fallback de navegación cuando la respuesta de accept no incluye assignment. */
  payNow?: boolean | null;
  onDismiss: () => void;
  /** MOVO-211 AC4: ruta de la saga que tomó la aceptación. Sin ella (backend anterior) se
   * muestra el mensaje genérico. */
  assignment?: OfferAcceptanceAssignment | null;
  /** Monto bruto que se va a reservar (lo que paga el emisor). */
  amountArs?: number | null;
  /** Fecha de retiro acordada (`YYYY-MM-DD`), para la línea de tiempo de la ruta lejana. */
  pickupDate?: string | null;
  /** Ruta cercana: ir a la pantalla de pago (MOVO-269). */
  onPay?: () => void;
  testID?: string;
}

/**
 * Modal de éxito con animación al elegir oferta (MOVO-150 / MOVO-244 / MOVO-271).
 * Presenta confirmación háptica, barra de progreso y auto-redirección al detalle
 * del envío tras `AUTO_DISMISS_MS`, con opción de tocar para avanzar antes.
 */
export function ChooseOfferSuccessModal({
  visible,
  carrierName,
  payNow = null,
  onDismiss,
  assignment,
  amountArs,
  pickupDate,
  onPay,
  testID,
}: ChooseOfferSuccessModalProps) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  const progress = useSharedValue(0);

  const displayName = carrierName || "el transportista";
  const firstName = carrierName?.split(" ")[0] ?? null;
  // MOVO-211 AC4: con retiro cercano la aceptación lleva directo al pago, así que no se
  // redirige solo (el emisor tiene que elegir pagar). Los dos desenlaces se leen como éxito.
  const isNear = assignment?.fundingRoute === "near" && !!onPay;
  const isFar = assignment?.fundingRoute === "far";
  const autoDismiss = !isNear;
  const id = testID ?? "choose-offer-success-modal";
  const fallbackSubtitle =
    payNow === true
      ? `Seleccionaste la propuesta de ${displayName}. Ahora reservá el pago con tu tarjeta para confirmar el viaje: se cobra recién cuando se entrega el paquete.`
      : payNow === false
        ? `Seleccionaste la propuesta de ${displayName}. Todavía no pagás nada: vas a reservar el pago desde el detalle del envío, antes del retiro.`
        : `Seleccionaste la propuesta de ${displayName}. Tu envío quedó en espera de la confirmación del pago para iniciar el viaje.`;

  // `onDismiss` no está memoizado en todos los callers (`offers.tsx` le pasa una
  // función inline) — cualquier re-render del padre mientras el modal está visible
  // (el propio `handleConfirmAccept` dispara refetch/invalidations justo después de
  // mostrarlo) le daba una identidad nueva y reiniciaba TODO el efecto: haptics de
  // nuevo, `progress` vuelto a 0, y el timer de auto-dismiss cancelado y
  // re-armado desde cero (MOVO-244 review, PR #184). Con la ref, el efecto solo
  // corre una vez por apertura (`visible`), sin importar cuántas veces se re-renderice
  // el padre mientras tanto.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (visible && !autoDismiss) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (visible) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      progress.value = 0;
      progress.value = withTiming(1, { duration: AUTO_DISMISS_MS - 100 });
      const timer = setTimeout(() => {
        onDismissRef.current();
      }, AUTO_DISMISS_MS);
      return () => clearTimeout(timer);
    } else {
      progress.value = 0;
    }
    // `progress` (shared value de Reanimated) queda fuera de deps a propósito, mismo
    // criterio que `use-sheet-animation.ts` — es una referencia estable en runtime
    // real, incluirla acá no aporta nada y en el mock de Jest de `useSharedValue`
    // (que sí cambia de identidad en cada render, a diferencia del real) reiniciaba
    // este efecto en cualquier re-render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoDismiss]);

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <Modal
      visible={isMounted}
      animationType="none"
      transparent
      onRequestClose={onDismiss}
      testID={testID ?? "choose-offer-success-modal"}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <View className="flex-1">
          {/* Overlay fade */}
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              testID={testID ? `${testID}-backdrop` : "choose-offer-success-backdrop"}
              onPress={onDismiss}
              className="flex-1 bg-black/50"
            />
          </Animated.View>

          {/* Sheet container */}
          <View pointerEvents="box-none" className="flex-1 justify-end">
            <Animated.View
              style={sheetStyle}
              className="rounded-t-[24px] border-t border-border bg-bg px-5 pb-2"
            >
              <SafeAreaView edges={["bottom"]} className="gap-5 items-center">
                {/* MOVO-271 AC2: mismo momento de éxito animado que al calificar
                    (`SuccessMoment`). Se monta con el modal, así que la animación
                    arranca en cada apertura y termina (~600ms) antes del auto-dismiss. */}
                {isNear ? (
                  <SuccessMoment
                    title={`Elegiste a ${firstName ?? "tu transportista"}`}
                    subtitle="Como el retiro es pronto, el último paso es reservar el pago. Se retiene en tu tarjeta y se cobra recién cuando el paquete se entrega."
                    testID={testID ? `${testID}-moment` : "choose-offer-success-moment"}
                  />
                ) : isFar ? (
                  <SuccessMoment
                    title={`${firstName ?? "Tu transportista"} lleva tu paquete`}
                    subtitle={`Ya está confirmado. Como el retiro es ${pickupDate ? `el ${formatPickupDayLabel(pickupDate)}` : "más adelante"}, el pago lo confirmás más cerca de la fecha y te avisamos. Hoy no se retiene ni se cobra nada.`}
                    testID={testID ? `${testID}-moment` : "choose-offer-success-moment"}
                  />
                ) : (
                  <SuccessMoment
                    title="¡Oferta aceptada!"
                    subtitle={fallbackSubtitle}
                    testID={testID ? `${testID}-moment` : "choose-offer-success-moment"}
                  />
                )}

                {isNear && amountArs != null ? (
                  <View
                    testID={`${id}-near-amount`}
                    className="w-full flex-row items-center justify-between rounded-md border border-border bg-bg-mute px-3.5 py-3"
                  >
                    <View>
                      <Text className="font-sans-medium text-caption uppercase tracking-wider text-fg-3">
                        Precio de la oferta
                      </Text>
                      <Text className="mt-0.5 font-sans-semibold text-[20px] text-fg">{formatPriceArs(amountArs)}</Text>
                    </View>
                    <Text className="text-right font-sans text-[12px] leading-[17px] text-fg-2">
                      El total a reservar se muestra{"\n"}antes de confirmar el pago.
                    </Text>
                  </View>
                ) : null}

                {isFar && assignment?.fundingWindowOpensAt ? (
                  <View className="w-full">
                    <FundingTimeline
                      testID={`${id}-far-timeline`}
                      steps={[
                        { when: "Hoy", what: firstName ? `${firstName} confirmado` : "Transportista confirmado", done: true },
                        { when: formatFundingDay(assignment.fundingWindowOpensAt), what: "Confirmás el pago" },
                        { when: pickupDate ? formatPickupDayLabel(pickupDate) : "Retiro", what: "Retiro" },
                      ]}
                    />
                  </View>
                ) : null}

                {autoDismiss ? (
                  <View className="w-full gap-2 px-2 items-center">
                    <View className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <Animated.View
                        style={progressBarStyle}
                        className="h-full rounded-full bg-lime-500"
                      />
                    </View>
                    <Text className="font-sans text-[12px] text-fg-3">
                      {!assignment && payNow === true
                        ? "Te llevamos a reservar el pago..."
                        : "Redirigiendo al detalle del envío..."}
                    </Text>
                  </View>
                ) : null}

                <View className="w-full pt-1">
                  {isNear ? (
                    <Pressable
                      testID={`${id}-pay-btn`}
                      onPress={onPay}
                      accessibilityRole="button"
                      className="h-12 w-full flex-row items-center justify-center gap-2.5 rounded-[12px] bg-fg active:opacity-85"
                    >
                      <View className="h-1.5 w-1.5 rounded-full bg-lime-500" />
                      <Text className="font-sans-semibold text-small text-bg">Reservar el pago</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      testID={testID ? `${testID}-dismiss-btn` : "choose-offer-success-dismiss-button"}
                      onPress={onDismiss}
                      className="h-12 w-full items-center justify-center rounded-[12px] bg-lime-500 active:bg-lime-400"
                    >
                      <Text className="font-sans-semibold text-small text-ink-950">
                        {!assignment && payNow === true ? "Reservar el pago" : "Ver detalle del envío"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </SafeAreaView>
            </Animated.View>
          </View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
