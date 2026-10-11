import { useRef } from "react";
import { Text, View } from "react-native";
import { ErrorBanner } from "../ui/error-banner";
import { ConfirmActionSheet } from "../ui/confirm-action-sheet";
import type { OfferSummary } from "../../src/api/offers-client";
import { formatPriceArs } from "../../src/lib/shipment-format";

export interface ChooseOfferModalProps {
  offer: OfferSummary | null;
  visible: boolean;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onClose: () => void;
  /** Se llama cuando el sheet terminó de cerrarse y su `Modal` nativo ya no está. */
  onClosed?: () => void;
  testID?: string;
}

export function ChooseOfferModal({
  offer,
  visible,
  isPending,
  errorMessage,
  onConfirm,
  onClose,
  onClosed,
  testID = "choose-offer-modal",
}: ChooseOfferModalProps) {
  // Se recuerda la última oferta para que el contenido no desaparezca durante la animación de cierre.
  const lastOfferRef = useRef<OfferSummary | null>(offer);
  if (offer) {
    lastOfferRef.current = offer;
  }
  const currentOffer = offer ?? lastOfferRef.current;
  if (!currentOffer) return null;

  const carrierName = currentOffer.carrierNameAtOffer || "este transportista";
  const formattedPrice = formatPriceArs(currentOffer.priceOffered);

  return (
    <ConfirmActionSheet
      visible={visible}
      title="¿Elegir esta oferta?"
      description={
        <>
          Vas a seleccionar la propuesta de <Text className="font-sans-semibold text-fg">{carrierName}</Text> por{" "}
          <Text className="font-sans-semibold text-fg">{formattedPrice}</Text>.
        </>
      }
      confirmLabel="Confirmar elección"
      isPending={isPending}
      onConfirm={onConfirm}
      onClose={onClose}
      onClosed={onClosed}
      testID={testID}
    >
      <View className="rounded-[12px] bg-bg-mute p-3.5">
        <Text className="font-sans text-caption leading-4 text-fg-3">
          Las demás ofertas recibidas para este envío quedarán descartadas y el envío pasará a tener transportista
          asignado.
        </Text>
      </View>
      {errorMessage ? <ErrorBanner testID={`${testID}-error`} message={errorMessage} /> : null}
    </ConfirmActionSheet>
  );
}
