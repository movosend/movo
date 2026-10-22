import type { OwnAccountSanction } from "@movo/shared/dist/types/account-sanctions";
import { router } from "expo-router";
import { ChevronRight, ShieldAlert } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { KYC_TONE_ICON_HEX } from "../../src/lib/kyc-status-ui";
import { suspensionPeriodText } from "../../src/lib/account-restriction";

export interface AccountSuspendedBannerProps {
  /** Suspensión vigente (`useActiveSuspension`); sin ella no se renderiza nada. */
  suspension: OwnAccountSanction | null;
  testID?: string;
}

/**
 * Aviso permanente de cuenta suspendida en el inicio (MOVO-300 AC1). Es compacto a propósito:
 * el motivo, lo que se puede y no se puede hacer y el contacto viven en `/account-status`, que
 * abre al tocarlo. No se puede descartar: desaparece solo cuando la suspensión se levanta o
 * vence (AC7, ver `useActiveSuspension`).
 */
export function AccountSuspendedBanner({
  suspension,
  testID,
}: AccountSuspendedBannerProps) {
  if (!suspension) return null;

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push("/account-status" as any)}
      accessibilityRole="button"
      accessibilityHint="Abre el detalle de la suspensión"
      className="mb-6 flex-row items-start gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3 active:opacity-80"
    >
      <ShieldAlert
        size={18}
        color={KYC_TONE_ICON_HEX.warning}
        strokeWidth={1.8}
      />
      <View className="flex-1">
        <Text
          testID={testID ? `${testID}-title` : undefined}
          className="font-sans-semibold text-[13px] text-ink-950"
        >
          Tu cuenta está suspendida {suspensionPeriodText(suspension)}
        </Text>
        <Text className="mt-0.5 font-sans text-[13px] text-ink-950">
          Podés terminar lo que tenés en curso, pero no iniciar envíos, ofertas
          ni viajes nuevos.
        </Text>
        <Text className="mt-1 font-sans-medium text-[13px] text-ink-950 underline">
          Ver detalle
        </Text>
      </View>
      <ChevronRight
        size={16}
        color={KYC_TONE_ICON_HEX.warning}
        strokeWidth={1.8}
      />
    </Pressable>
  );
}
