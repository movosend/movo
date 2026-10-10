import { useRef } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { ErrorBanner } from "../ui/error-banner";
import type { OfferSummary } from "../../src/api/offers-client";
import { formatPriceArs } from "../../src/lib/shipment-format";

export interface RejectOfferModalProps {
  offer: OfferSummary | null;
  visible: boolean;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onClose: () => void;
  testID?: string;
}

export function RejectOfferModal({
  offer,
  visible,
  isPending,
  errorMessage,
  onConfirm,
  onClose,
  testID,
}: RejectOfferModalProps) {
  const lastOfferRef = useRef<OfferSummary | null>(offer);
  if (offer) {
    lastOfferRef.current = offer;
  }
  const currentOffer = offer ?? lastOfferRef.current;

  if (!currentOffer) return null;

  const carrierName = currentOffer.carrierNameAtOffer || "este transportista";
  const formattedPrice = formatPriceArs(currentOffer.priceOffered);

  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={() => !isPending && onClose()}
      testID={testID ?? "reject-offer-modal"}
      backdropTestID={testID ? `${testID}-backdrop` : "reject-offer-modal-backdrop"}
      backdropClassName="bg-black/50"
      sheetClassName="rounded-t-[24px] border-t border-border bg-bg px-5 pt-5"
      contentClassName="gap-4"
    >
      <Text className="font-sans-semibold text-h3 text-fg">
        ¿Rechazar esta oferta?
      </Text>

      <Text className="font-sans text-small leading-5 text-fg-2">
        Vas a rechazar la propuesta de{" "}
        <Text className="font-sans-semibold text-fg">{carrierName}</Text> por{" "}
        <Text className="font-sans-semibold text-fg">{formattedPrice}</Text>.
      </Text>

      <View className="rounded-[12px] bg-bg-mute p-3.5">
        <Text className="font-sans text-caption leading-4 text-fg-3">
          La oferta se quitará de la lista. Tu envío seguirá publicado y disponible
          para recibir otras propuestas de transportistas.
        </Text>
      </View>

      {errorMessage ? (
        <ErrorBanner
          testID={testID ? `${testID}-error` : "reject-offer-error-banner"}
          message={errorMessage}
        />
      ) : null}

      <View className="gap-2.5 pt-2">
        <Pressable
          testID={testID ? `${testID}-confirm-btn` : "reject-offer-confirm-button"}
          onPress={onConfirm}
          disabled={isPending}
          className="h-12 items-center justify-center rounded-[12px] bg-danger-600 active:bg-danger-700"
        >
          {isPending ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text className="font-sans-semibold text-small text-white">
              Rechazar oferta
            </Text>
          )}
        </Pressable>

        <Pressable
          testID={testID ? `${testID}-cancel-btn` : "reject-offer-cancel-button"}
          onPress={onClose}
          disabled={isPending}
          className="h-11 items-center justify-center rounded-[12px]"
        >
          <Text className="font-sans-medium text-small text-fg-2">
            Volver
          </Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}
