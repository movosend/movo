import type { SupportStatus } from "@movo/shared/dist/types/admin-support";
import { Text, View } from "react-native";
import { supportStatusLabel, supportStatusTone, type SupportStatusTone } from "../../src/lib/support-format";

const TONE_CLASS: Record<SupportStatusTone, [string, string]> = {
  warning: ["bg-warning-100", "text-warning-700"],
  info: ["bg-info-100", "text-info-700"],
  neutral: ["bg-bg-mute", "text-fg-2"],
};

/** MOVO-324: píldora de estado de una consulta (Abierta / Esperando tu respuesta / Resuelta). */
export function SupportStatusPill({ status, testID }: { status: SupportStatus; testID?: string }) {
  const [bg, text] = TONE_CLASS[supportStatusTone(status)];
  return (
    <View testID={testID} className={`rounded-full px-2.5 py-1 ${bg}`}>
      <Text numberOfLines={1} className={`font-sans-medium text-[11px] ${text}`}>
        {supportStatusLabel(status)}
      </Text>
    </View>
  );
}
