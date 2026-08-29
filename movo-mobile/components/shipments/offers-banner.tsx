import { router } from "expo-router";
import { ChevronRight, Inbox } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useShipmentOffers } from "../../src/hooks/use-offers";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface OffersBannerProps {
  shipmentId?: string;
  offersCount?: number;
  testID?: string;
}

/**
 * Banner de acceso a ofertas recibidas en el detalle del envío (MOVO-150 / MOVO-17).
 * Muestra el contador visible ("Ofertas recibidas (N)") y al presionarlo navega a
 * `/shipments/[id]/offers`.
 */
export function OffersBanner({ shipmentId, offersCount, testID }: OffersBannerProps) {
  const colors = useThemeColors();
  const { data: offers } = useShipmentOffers(shipmentId, { sort: "price" }, {
    enabled: offersCount === undefined && !!shipmentId,
  });

  const count = offersCount ?? (offers ? offers.length : 0);
  const hasOffers = count > 0;

  const handlePress = () => {
    if (shipmentId) {
      router.push(`/shipments/${shipmentId}/offers` as never);
    }
  };

  return (
    <Pressable
      testID={testID ?? "offers-banner"}
      onPress={handlePress}
      disabled={!shipmentId}
      className={`flex-row items-center gap-3 rounded-[12px] px-4 py-3.5 border ${
        hasOffers
          ? "border-primary/30 bg-bg-mute active:bg-bg-mute/80"
          : "border-transparent bg-bg-mute active:opacity-80"
      }`}
      accessibilityRole="button"
      accessibilityLabel={`Ofertas recibidas, ${count} disponibles`}
    >
      <View
        className={`h-[42px] w-[42px] items-center justify-center rounded-[10px] ${
          hasOffers ? "bg-primary/15" : "bg-fg/10"
        }`}
      >
        <Inbox size={18} color={hasOffers ? colors.fg1 : colors.fg3} strokeWidth={1.8} />
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            testID={testID ? `${testID}-title` : "offers-banner-title"}
            className="font-sans-semibold text-[15px] text-fg"
          >
            {hasOffers ? `Ofertas recibidas (${count})` : "Ofertas"}
          </Text>
          {hasOffers ? (
            <View className="rounded-full bg-lime-500 px-2 py-0.5">
              <Text className="font-sans-semibold text-[11px] text-ink-950">{count}</Text>
            </View>
          ) : null}
        </View>

        <Text
          testID={testID ? `${testID}-subtitle` : "offers-banner-subtitle"}
          className="mt-0.5 font-sans text-[12px] text-fg-3"
        >
          {hasOffers
            ? "Compará las propuestas y elegí un transportista"
            : "Aún no tenés ofertas"}
        </Text>
      </View>

      <ChevronRight size={18} color={colors.fg3} />
    </Pressable>
  );
}
