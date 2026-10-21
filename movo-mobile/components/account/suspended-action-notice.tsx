import type { OwnAccountSanction } from "@movo/shared/dist/types/account-sanctions";
import { Lock } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  suspendedActionMessage,
  type SuspendedAction,
} from "../../src/lib/account-restriction";

export interface SuspendedActionNoticeProps {
  action: SuspendedAction;
  suspension: OwnAccountSanction;
  testID?: string;
}

/**
 * Explicación junto a un botón que inicia algo nuevo y queda deshabilitado por una suspensión
 * (MOVO-300 AC2). Misma caja gris que el bloqueo de inicio de viaje de `carrier-trip-cta.tsx`:
 * el usuario sabe por qué no puede, en vez de completar un formulario y recién ahí ver el 403.
 */
export function SuspendedActionNotice({
  action,
  suspension,
  testID,
}: SuspendedActionNoticeProps) {
  const colors = useThemeColors();
  return (
    <View
      testID={testID}
      className="w-full flex-row items-center justify-center gap-2 rounded-[8px] bg-bg-mute px-4 py-3"
    >
      <Lock size={16} strokeWidth={1.8} color={colors.fg3} />
      <Text className="flex-1 font-sans-medium text-[14px] text-fg-2">
        {suspendedActionMessage(action, suspension)}
      </Text>
    </View>
  );
}
