import { useRef } from "react";
import { Text, View } from "react-native";
import { ErrorBanner } from "../ui/error-banner";
import { ConfirmActionSheet } from "../ui/confirm-action-sheet";
import type { OfferSummary } from "../../src/api/offers-client";
import { FUNDING_WINDOW_DAYS, formatPriceArs } from "../../src/lib/shipment-format";

export interface ChooseOfferModalProps {
  offer: OfferSummary | null;
  visible: boolean;
  isPending: boolean;
  errorMessage: string | null;
  /** ¿El pago se reserva ya, al elegir? `false`: retiro lejano, se reserva más adelante
   * desde el detalle. `null`: no se sabe, no se promete nada del momento. */
  payNow?: boolean | null;
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
  payNow = null,
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
      {payNow !== null ? (
        <View testID={`${testID}-payment-note`} className="rounded-[12px] bg-bg-mute p-3.5">
          <Text className="font-sans text-caption leading-4 text-fg-3">
            <Text className="font-sans-semibold text-fg">
              {payNow ? "Después te pedimos reservar el pago. " : "Todavía no pagás nada. "}
            </Text>
            {payNow
              ? "Te llevamos a elegir tu tarjeta. Es solo una reserva: el cobro se hace recién cuando el paquete se entrega."
              : `Vas a reservar el pago con tu tarjeta desde el detalle del envío, desde ${FUNDING_WINDOW_DAYS} días antes del retiro. El cobro se hace recién cuando el paquete se entrega.`}
          </Text>
        </View>
      ) : null}
      {errorMessage ? <ErrorBanner testID={`${testID}-error`} message={errorMessage} /> : null}
    </ConfirmActionSheet>
  );
}
