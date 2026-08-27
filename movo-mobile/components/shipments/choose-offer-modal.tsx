import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { ErrorBanner } from "../ui/error-banner";
import type { OfferSummary } from "../../src/api/offers-client";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { formatPriceArs } from "../../src/lib/shipment-format";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface ChooseOfferModalProps {
  offer: OfferSummary | null;
  visible: boolean;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onClose: () => void;
  testID?: string;
}

export function ChooseOfferModal({
  offer,
  visible,
  isPending,
  errorMessage,
  onConfirm,
  onClose,
  testID,
}: ChooseOfferModalProps) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  if (!offer) return null;

  const carrierName = offer.carrierNameAtOffer || "este transportista";
  const formattedPrice = formatPriceArs(offer.priceOffered);

  return (
    <Modal
      visible={isMounted}
      animationType="none"
      transparent
      onRequestClose={() => !isPending && onClose()}
      testID={testID ?? "choose-offer-modal"}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <View className="flex-1">
          {/* Overlay fade */}
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              testID={testID ? `${testID}-backdrop` : "choose-offer-modal-backdrop"}
              onPress={() => !isPending && onClose()}
              className="flex-1 bg-black/50"
            />
          </Animated.View>

          {/* Sheet container */}
          <View pointerEvents="box-none" className="flex-1 justify-end">
            <Animated.View
              style={sheetStyle}
              className="rounded-t-[24px] border-t border-border bg-bg px-5 pt-5"
            >
              <SafeAreaView edges={["bottom"]} className="gap-4">
                <Text className="font-sans-semibold text-h3 text-fg">
                  ¿Elegir esta oferta?
                </Text>

                <Text className="font-sans text-small leading-5 text-fg-2">
                  Vas a seleccionar la propuesta de{" "}
                  <Text className="font-sans-semibold text-fg">{carrierName}</Text> por{" "}
                  <Text className="font-sans-semibold text-fg">{formattedPrice}</Text>.
                </Text>

                <View className="rounded-[12px] bg-bg-mute p-3.5">
                  <Text className="font-sans text-caption leading-4 text-fg-3">
                    Las demás ofertas recibidas para este envío quedarán descartadas y el
                    envío pasará a tener transportista asignado.
                  </Text>
                </View>

                {errorMessage ? (
                  <ErrorBanner
                    testID={testID ? `${testID}-error` : "choose-offer-error-banner"}
                    message={errorMessage}
                  />
                ) : null}

                <View className="gap-2.5 pt-2">
                  <Pressable
                    testID={testID ? `${testID}-confirm-btn` : "choose-offer-confirm-button"}
                    onPress={onConfirm}
                    disabled={isPending}
                    className="h-12 items-center justify-center rounded-[12px] bg-lime-500 active:bg-lime-400"
                  >
                    {isPending ? (
                      <ActivityIndicator color="#0A0A0B" size="small" />
                    ) : (
                      <Text className="font-sans-semibold text-small text-ink-950">
                        Confirmar elección
                      </Text>
                    )}
                  </Pressable>

                  <Pressable
                    testID={testID ? `${testID}-cancel-btn` : "choose-offer-cancel-button"}
                    onPress={onClose}
                    disabled={isPending}
                    className="h-11 items-center justify-center rounded-[12px]"
                  >
                    <Text className="font-sans-medium text-small text-fg-2">
                      Volver
                    </Text>
                  </Pressable>
                </View>
              </SafeAreaView>
            </Animated.View>
          </View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
