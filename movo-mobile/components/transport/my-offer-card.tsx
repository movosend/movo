import { OfferStatus } from "@movo/shared/dist/types/offer";
import { Pressable, Text, View } from "react-native";
import type { MyOfferSummary } from "../../src/api/offers-client";
import { offerStatusLabel } from "../../src/lib/offer-format";
import { formatPickupDateLabel, formatPriceArs, shortAddressLabel } from "../../src/lib/shipment-format";

/** Chip de estado (AC2/AC3 de MOVO-151): copy explicativo, nunca el enum crudo
 * (`offerStatusLabel`), con tratamiento visual propio por estado -- mismo lenguaje
 * de chip `rounded-full` que ya usa `AvailableShipmentRow` para "Oferta aceptada". */
const STATUS_CHIP_CLASS: Record<OfferStatus, string> = {
  [OfferStatus.PENDING]: "bg-bg-mute text-fg-2",
  [OfferStatus.ACCEPTED]: "bg-info-100 text-info-700",
  [OfferStatus.REJECTED]: "bg-danger-100 text-danger-700",
  [OfferStatus.WITHDRAWN]: "bg-bg-mute text-fg-3",
  [OfferStatus.EXPIRED]: "bg-bg-mute text-fg-3",
  [OfferStatus.SUPERSEDED]: "bg-bg-mute text-fg-3",
};

export interface MyOfferCardNotice {
  text: string;
  tone: "positive" | "warning";
}

interface MyOfferCardProps {
  offer: MyOfferSummary;
  onPress: () => void;
  testID: string;
  /** Aviso accionable opcional (MOVO-151/188): ranking competitivo perdiendo para una
   * `pending`, o "seguí el retiro" para una `accepted`. Ausente en el resto -- una
   * card sin aviso es una fila de información, no una que "requiere algo tuyo". */
  notice?: MyOfferCardNotice | null;
}

function routeLabel(offer: MyOfferSummary): string {
  return `${shortAddressLabel(offer.shipment.pickupAddress)} → ${shortAddressLabel(offer.shipment.deliveryAddress)}`;
}

/**
 * Card de una oferta propia del transportista en "Mis ofertas" (MOVO-151, listado
 * completo del bridge armado en MOVO-183). Reemplaza la fila plana de una sola línea
 * que tenía `carrier/offers/index.tsx` -- ahora con fecha de retiro + distancia
 * (`MyOfferShipmentContext.distanceKm`, MOVO-185), el neto real (`priceNetArs`,
 * MOVO-186, no el bruto `priceOffered`) y un aviso opcional con su propio
 * tratamiento visual (fondo lima para positivo, mute para de atención).
 */
export function MyOfferCard({ offer, onPress, testID, notice }: MyOfferCardProps) {
  const pickupLabel = formatPickupDateLabel(offer.shipment.pickupDate) ?? offer.shipment.pickupDate;
  const distanceLabel = `${offer.shipment.distanceKm.toFixed(1).replace(".", ",")} km`;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className={`gap-2.5 rounded-md p-3.5 ${
        notice ? "border-[1.5px] border-fg bg-bg" : "border border-border bg-bg"
      }`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <View
            className={`self-start rounded-full px-2 py-0.5 ${STATUS_CHIP_CLASS[offer.status]}`}
          >
            <Text className="font-sans-semibold text-[10px] uppercase tracking-wide">
              {offerStatusLabel(offer.status)}
            </Text>
          </View>
          <Text numberOfLines={1} className="mt-1.5 font-sans-semibold text-[15px] text-fg">
            {routeLabel(offer)}
          </Text>
          <Text className="mt-0.5 font-sans text-[11.5px] text-fg-3">
            {pickupLabel} · {distanceLabel}
          </Text>
        </View>
        <View className="items-end gap-0.5">
          <Text className="font-sans-semibold text-[17px] leading-[20px] tracking-[-0.02em] text-fg">
            {formatPriceArs(offer.priceNetArs)}
          </Text>
          <Text className="font-sans text-[10px] text-fg-3">te queda</Text>
        </View>
      </View>
      {notice ? (
        <View
          testID={`${testID}-notice`}
          className={`rounded-md px-2.5 py-2 ${notice.tone === "positive" ? "bg-lime-200/60" : "bg-bg-mute"}`}
        >
          <Text
            className={`font-sans-medium text-[12px] leading-[16px] ${
              notice.tone === "positive" ? "text-[#4A5A20]" : "text-fg-2"
            }`}
          >
            {notice.text}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
