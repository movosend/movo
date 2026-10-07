import { Text, View } from "react-native";
import { formatPriceArs } from "../../src/lib/shipment-format";
import { HighDemandBadge } from "../shipments/high-demand-badge";
import { GridPattern } from "../ui/grid-pattern";

interface PricePreviewCardProps {
  suggestedPriceArs: number | null;
  caption: string;
  /** Muestra el badge de alta demanda (MOVO-254); cuándo corresponde lo decide el caller. */
  highDemand?: boolean;
  testID?: string;
}

/** Card de precio sugerido del paso de resumen (AC7/AC8) — relleno lime plano (no
 * `GradientBorderCard`, ese efecto "chrome" es de card silenciosa; acá el precio tiene
 * que resaltar, como en el mockup de diseño). */
export function PricePreviewCard({
  suggestedPriceArs,
  caption,
  highDemand = false,
  testID,
}: PricePreviewCardProps) {
  return (
    <View
      testID={testID}
      className="relative overflow-hidden rounded-[14px] bg-lime-500 px-5 py-4"
    >
      <GridPattern />
      <Text className="font-sans-semibold text-[11px] uppercase tracking-widest text-ink-950/50">
        Costo aproximado
      </Text>
      <Text className="mt-1 font-sans-semibold text-[38px] tracking-tight text-ink-950">
        {formatPriceArs(suggestedPriceArs)}
      </Text>
      {highDemand ? (
        <View className="mt-2">
          <HighDemandBadge testID={testID ? `${testID}-high-demand` : undefined} />
        </View>
      ) : null}
      <Text className="mt-2 font-sans text-[11px] uppercase tracking-wide text-ink-950/45">
        {caption}
      </Text>
      <Text className="mt-3 font-sans text-[13px] leading-5 text-ink-950/60">
        Este es el costo aproximado calculado por Movo para tu envío. Una vez publicado,
        los transportistas comenzarán a ofertar y vas a poder elegir la opción que más te convenga.
      </Text>
    </View>
  );
}
