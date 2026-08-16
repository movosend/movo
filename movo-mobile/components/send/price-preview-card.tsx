import { Text, View } from "react-native";
import { formatPriceArs } from "../../src/lib/shipment-format";

interface PricePreviewCardProps {
  suggestedPriceArs: number | null;
  caption: string;
  testID?: string;
}

/** Card de precio sugerido del paso de resumen (AC7/AC8) — relleno lime plano (no
 * `GradientBorderCard`, ese efecto "chrome" es de card silenciosa; acá el precio tiene
 * que resaltar, como en el mockup de diseño). */
export function PricePreviewCard({ suggestedPriceArs, caption, testID }: PricePreviewCardProps) {
  return (
    <View testID={testID} className="overflow-hidden rounded-[14px] bg-lime-500 px-5 py-4">
      <Text className="font-sans-semibold text-[11px] uppercase tracking-widest text-ink-950/50">
        Precio sugerido
      </Text>
      <Text className="mt-1 font-sans-semibold text-[38px] tracking-tight text-ink-950">
        {formatPriceArs(suggestedPriceArs)}
      </Text>
      <Text className="mt-2 font-sans text-[11px] uppercase tracking-wide text-ink-950/45">{caption}</Text>
      <Text className="mt-3 font-sans text-[13px] leading-5 text-ink-950/60">
        Este número es una estimación — el precio final queda sujeto a la oferta que acepte un
        transportista.
      </Text>
    </View>
  );
}
