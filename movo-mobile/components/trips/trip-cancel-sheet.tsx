import { AlertCircle, AlertTriangle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import type { TripCancelPhase, TripCancelRow } from "../../src/hooks/use-cancel-trip-with-packages";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { carrierDebtNotice } from "../../src/lib/cancellation-format";
import { getInitials } from "../../src/lib/profile-format";
import { formatSettlementAmount } from "../../src/lib/settlement-format";
import { ErrorBanner } from "../ui/error-banner";

/**
 * MOVO-314: cancelar un viaje con paquetes aceptados. El sheet lista cada envío con lo que cuesta
 * bajarse (sin cargo, o el monto de la deuda) y avisa el total. La cotización y la ejecución en
 * secuencia viven en `useCancelTripWithPackages`.
 */
export interface TripCancelPackagesProps {
  rows: TripCancelRow[];
  phase: TripCancelPhase;
  totalDebtArs: number;
  mismatchNotice: { title: string; body: string } | null;
  onRetryQuote: () => void;
}

/**
 * Bottom sheet de confirmación de "Cancelar viaje" (MOVO-263 AC6, mockup de Claude Design).
 * El error de la mutación (ej. 409 por un paquete aceptado en el medio) se muestra adentro y
 * no cierra el sheet: el usuario lo lee antes de volver.
 *
 * MOVO-266: en el viaje vigente de una serie recurrente (`recurring`) suma dos opciones,
 * "Solo este viaje" (default, la serie sigue) y "Este y dejar de repetir"; `onConfirm`
 * recibe cuál se eligió. Sin `recurring` queda igual que antes.
 */
export function TripCancelSheet({
  visible,
  destination,
  isCancelling,
  errorMessage,
  recurring,
  packages,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  destination: string;
  isCancelling: boolean;
  errorMessage?: string | null;
  /** Nombre del día de la salida ("viernes"), para "el viaje de este viernes". */
  recurring?: { weekdayName: string };
  /** Solo con paquetes aceptados (MOVO-314). */
  packages?: TripCancelPackagesProps;
  onConfirm: (stopRecurrence: boolean) => void;
  onClose: () => void;
}) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  const [stopRecurrence, setStopRecurrence] = useState(false);
  // Cada apertura arranca en la opción default.
  useEffect(() => {
    if (visible) setStopRecurrence(false);
  }, [visible]);

  const options = recurring
    ? [
        {
          value: false,
          title: "Solo este viaje",
          description: `Cancelás solo el viaje de este ${recurring.weekdayName}; el del próximo se declara igual.`,
        },
        {
          value: true,
          title: "Este y dejar de repetir",
          description: "Cancelás este viaje y no declaramos los siguientes.",
        },
      ]
    : null;

  const quoting = packages ? packages.phase === "quoting" || packages.phase === "idle" : false;
  const quoteFailed = packages?.phase === "quoteError";
  const confirmBlocked = isCancelling || quoting || quoteFailed;
  const hasDebt = (packages?.totalDebtArs ?? 0) > 0;
  const confirmLabel = packages && hasDebt ? "Sí, cancelar igual" : "Sí, cancelar viaje";

  return (
    <Modal visible={isMounted} transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Animated.View
          style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, backdropStyle]}
          className="bg-ink-950/50"
        >
          <Pressable testID="trip-cancel-backdrop" className="flex-1" onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={sheetStyle}
          className="items-center rounded-t-[14px] bg-bg px-5 pb-[38px] pt-2.5"
        >
          <View className="h-1 w-9 rounded-full bg-border-strong" />
          <View className="mt-6 h-[60px] w-[60px] items-center justify-center rounded-full bg-danger-100">
            <AlertTriangle size={28} color="#E5484D" strokeWidth={1.75} />
          </View>
          <Text className="mt-4 text-center font-sans-semibold text-[20px] tracking-[-0.4px] text-fg">
            ¿Cancelar el viaje a {destination}?
          </Text>
          <Text className="mt-2 max-w-[320px] text-center font-sans text-[14px] leading-[21px] text-fg-3">
            {packages
              ? `También se cancelan los ${packages.rows.length} envíos que aceptaste. Les avisamos a los emisores y sus envíos vuelven a publicarse.`
              : "Va a pasar a tu historial como cancelado y dejarás de recibir avisos de paquetes compatibles."}
          </Text>
          {packages ? (
            <View className="mt-5 self-stretch overflow-hidden rounded-[10px] border border-border">
              {packages.rows.map((row, index) => (
                <View
                  key={row.shipmentId}
                  testID={`trip-cancel-row-${row.shipmentId}`}
                  className={`flex-row items-center gap-2.5 px-3 py-2.5 ${index > 0 ? "border-t border-border" : ""}`}
                >
                  <View className="h-6 w-6 items-center justify-center rounded-full bg-fg">
                    <Text className="font-sans-semibold text-[10px] text-bg">{getInitials(row.senderName)}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="font-sans-medium text-[13px] leading-[18px] text-fg">{row.senderName}</Text>
                    <Text className="font-sans text-[12px] leading-4 text-fg-3" numberOfLines={1}>
                      {row.route}
                    </Text>
                  </View>
                  <View
                    testID={`trip-cancel-row-${row.shipmentId}-chip`}
                    className={`h-[22px] justify-center rounded-full px-[9px] ${
                      row.penaltyArs && row.penaltyArs > 0 ? "bg-warning-100" : "bg-bg-mute"
                    }`}
                  >
                    <Text
                      className={`font-sans-semibold text-[11px] ${
                        row.penaltyArs && row.penaltyArs > 0 ? "text-warning-700" : "text-fg-2"
                      }`}
                    >
                      {row.penaltyArs === null
                        ? "…"
                        : row.penaltyArs > 0
                          ? formatSettlementAmount(row.penaltyArs)
                          : "Sin cargo"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {packages && quoteFailed ? (
            <View className="mt-3 self-stretch gap-2">
              <View
                testID="trip-cancel-quote-error"
                className="flex-row gap-2.5 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
              >
                <AlertCircle size={16} color="#972327" strokeWidth={2} style={{ marginTop: 1 }} />
                <Text className="flex-1 font-sans text-[13px] leading-[18px] text-ink-950">
                  No pudimos calcular si tiene cargo. Probá de nuevo.
                </Text>
              </View>
              <Pressable
                testID="trip-cancel-retry-quote"
                onPress={packages.onRetryQuote}
                accessibilityRole="button"
                className="h-10 items-center justify-center rounded-lg bg-bg-mute"
              >
                <Text className="font-sans-medium text-[14px] text-fg">Reintentar</Text>
              </Pressable>
            </View>
          ) : null}
          {packages && quoting ? (
            <View testID="trip-cancel-quoting" className="mt-3 self-stretch items-center py-2">
              <ActivityIndicator />
            </View>
          ) : null}
          {packages && packages.mismatchNotice ? (
            <View
              testID="trip-cancel-mismatch"
              className="mt-3 self-stretch flex-row gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3"
            >
              <AlertTriangle size={16} color="#A97714" strokeWidth={2} style={{ marginTop: 1 }} />
              <View className="flex-1">
                <Text className="font-sans-semibold text-[13px] leading-[18px] text-ink-950">
                  {packages.mismatchNotice.title}
                </Text>
                <Text className="mt-0.5 font-sans text-[12.5px] leading-[17px] text-ink-600">
                  {packages.mismatchNotice.body}
                </Text>
              </View>
            </View>
          ) : null}
          {packages && packages.phase === "ready" ? (
            hasDebt ? (
              <View className="mt-3 self-stretch flex-row gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3">
                <AlertCircle size={16} color="#A97714" strokeWidth={2} style={{ marginTop: 1 }} />
                <Text testID="trip-cancel-debt" className="flex-1 font-sans text-[13px] leading-[19px] text-ink-950">
                  Faltan menos de 12 h para algún retiro. {carrierDebtNotice(packages.totalDebtArs)}
                </Text>
              </View>
            ) : (
              <Text testID="trip-cancel-free" className="mt-3 self-stretch text-center font-sans text-[13px] leading-[18px] text-fg-3">
                Faltan más de 12 h para los retiros: no tiene cargo.
              </Text>
            )
          ) : null}
          {options ? (
            <View className="mt-5 self-stretch overflow-hidden rounded-[10px] border border-border">
              {options.map((option, index) => {
                const selected = stopRecurrence === option.value;
                return (
                  <Pressable
                    key={option.title}
                    testID={option.value ? "trip-cancel-option-stop" : "trip-cancel-option-only"}
                    onPress={() => setStopRecurrence(option.value)}
                    disabled={isCancelling}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    className={`flex-row gap-3 px-3.5 py-3 ${index > 0 ? "border-t border-border" : ""}`}
                  >
                    <View
                      className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full border-[1.5px] ${
                        selected ? "border-fg" : "border-border-strong"
                      }`}
                    >
                      {selected ? <View className="h-2.5 w-2.5 rounded-full bg-fg" /> : null}
                    </View>
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text className="font-sans-semibold text-[15px] text-fg">{option.title}</Text>
                      <Text className="font-sans text-[13px] leading-[19px] text-fg-3">{option.description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {errorMessage ? (
            <View className="mt-4 self-stretch">
              <ErrorBanner testID="trip-cancel-error" message={errorMessage} />
            </View>
          ) : null}
          <Pressable
            testID="trip-cancel-confirm"
            onPress={() => onConfirm(stopRecurrence)}
            disabled={confirmBlocked}
            accessibilityRole="button"
            className={`mt-6 h-[52px] self-stretch items-center justify-center rounded-lg bg-danger-500 active:opacity-90 ${
              quoting || quoteFailed ? "opacity-50" : ""
            }`}
          >
            {isCancelling ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="font-sans-semibold text-[16px] text-white">{confirmLabel}</Text>
            )}
          </Pressable>
          <Pressable
            testID="trip-cancel-dismiss"
            onPress={onClose}
            disabled={isCancelling}
            className="mt-1.5 h-12 self-stretch items-center justify-center rounded-lg"
          >
            <Text className="font-sans-medium text-[15px] text-fg">Volver</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
