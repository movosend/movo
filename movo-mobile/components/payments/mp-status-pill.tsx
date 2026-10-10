import type { MpConnectStatus } from "@movo/shared/dist/types/mp-connect";
import { Check } from "lucide-react-native";
import { Text, View } from "react-native";
import { STATE_COLORS } from "../../src/constants/state-colors";

/**
 * - `row`: la fila "Pagos y cobros" de Perfil → Configuración (Vinculado / Pendiente /
 *   Revisar).
 * - `card`: la tarjeta de la pantalla (Vinculada / Sin vincular / Dejó de funcionar).
 *
 * Los colores de estado son fijos en los dos temas (mismo criterio que el resto de la app).
 */
type PillVariant = "row" | "card";

const LABELS: Record<PillVariant, Record<MpConnectStatus, string>> = {
  row: { linked: "Vinculado", unlinked: "Pendiente", invalid: "Revisar" },
  card: { linked: "Vinculada", unlinked: "Sin vincular", invalid: "Dejó de funcionar" },
};

const TONE_CLASSES: Record<PillVariant, Record<MpConnectStatus, { bg: string; text: string }>> = {
  row: {
    linked: { bg: "bg-success-100", text: "text-success-700" },
    unlinked: { bg: "bg-warning-100", text: "text-warning-700" },
    invalid: { bg: "bg-danger-100", text: "text-danger-700" },
  },
  card: {
    linked: { bg: "bg-success-100", text: "text-success-700" },
    unlinked: { bg: "bg-warning-100", text: "text-warning-700" },
    // Va sobre la tarjeta roja: pill blanca para que se separe del fondo.
    invalid: { bg: "bg-paper", text: "text-danger-700" },
  },
};

export function MpStatusPill({
  status,
  variant,
  testID,
}: {
  status: MpConnectStatus;
  variant: PillVariant;
  testID?: string;
}) {
  const tone = TONE_CLASSES[variant][status];
  const padding = variant === "row" ? "px-[9px] py-[3px]" : "px-2.5 py-1";

  return (
    <View testID={testID} className={`flex-row items-center gap-1 rounded-full ${padding} ${tone.bg}`}>
      {variant === "card" && status === "linked" ? (
        <Check size={11} strokeWidth={2.6} color={STATE_COLORS.success700} />
      ) : null}
      <Text className={`font-sans-medium text-[11px] ${tone.text}`}>{LABELS[variant][status]}</Text>
    </View>
  );
}
