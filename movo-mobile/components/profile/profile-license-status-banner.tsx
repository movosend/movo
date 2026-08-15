import { KycStatus } from "@movo/shared/dist/types/user";
import * as Haptics from "expo-haptics";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  KYC_TONE_ICON_HEX,
  kycStatusIcon,
  kycStatusTone,
} from "../../src/lib/kyc-status-ui";

const COPY: Partial<Record<KycStatus, { title: string; body: string }>> = {
  [KycStatus.NOT_STARTED]: {
    title: "Verificá tu licencia de conducir",
    body: "Todavía no verificaste tu licencia. Hacelo para obtener la insignia de transportista verificado.",
  },
  [KycStatus.PENDING]: {
    title: "Verificación de licencia en curso",
    body: "Iniciaste una verificación que quedó sin resolver. Podés retomarla cuando quieras.",
  },
  [KycStatus.MANUAL_REVIEW]: {
    title: "Necesitamos revisar tu licencia",
    body: "Un especialista está mirando tu caso. Podés ver el detalle.",
  },
  [KycStatus.REJECTED]: {
    title: "No pudimos verificar tu licencia",
    body: "Los datos no coincidieron con tu carnet. Podés intentarlo de nuevo.",
  },
  [KycStatus.EXPIRED]: {
    title: "Tu verificación de licencia venció",
    body: "Pasó demasiado tiempo desde que la iniciaste. Hay que reintentarla.",
  },
};

// Mismo criterio que profile-kyc-status-banner.tsx: las escalas warning/danger todavía
// no tienen paso dark (ver nota en CLAUDE.md), NOT_STARTED usa un tono neutral.
const TONE_FRAME_CLASS: Record<"warning" | "danger" | "neutral", string> = {
  warning: "border-warning-300 bg-warning-100",
  danger: "border-danger-300 bg-danger-100",
  neutral: "border-border bg-bg-sub",
};

export interface ProfileLicenseStatusBannerProps {
  status: KycStatus;
  onPrimaryAction: () => void;
  testID?: string;
}

/**
 * Banner + CTA de estado de verificación de licencia (MOVO-15) — copia de
 * `ProfileKycStatusBanner` (identidad, MOVO-78 AC4/AC6) con textos propios de
 * licencia. El caller (`profile.tsx`) decide cuándo mostrarlo (solo con rol carrier);
 * este componente solo se oculta a sí mismo en `approved` — no hace falta alerta
 * cuando todo está bien, el badge `license_verified` ya lo comunica.
 */
export function ProfileLicenseStatusBanner({ status, onPrimaryAction, testID }: ProfileLicenseStatusBannerProps) {
  const colors = useThemeColors();
  if (status === KycStatus.APPROVED) return null;

  const copy = COPY[status];
  if (!copy) return null;

  const tone = kycStatusTone(status);
  const frameTone = tone === "success" ? "warning" : tone;
  const Icon = kycStatusIcon(status);
  const iconColor = frameTone === "neutral" ? colors.fg2 : KYC_TONE_ICON_HEX[frameTone];
  const primaryLabel = status === KycStatus.MANUAL_REVIEW ? "Ver estado" : "Reintentar verificación";

  return (
    <View
      testID={testID}
      className={`mb-5 gap-3 rounded-[10px] border px-3.5 py-3.5 ${TONE_FRAME_CLASS[frameTone]}`}
    >
      <View className="flex-row items-start gap-2.5">
        <Icon size={18} strokeWidth={1.8} color={iconColor} />
        <View className="flex-1">
          <Text className="mb-0.5 font-sans-semibold text-[13px] text-ink-950">{copy.title}</Text>
          <Text className="font-sans text-[13px] text-ink-950">{copy.body}</Text>
        </View>
      </View>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPrimaryAction();
        }}
        className="self-start rounded-full bg-fg px-4 py-2"
      >
        <Text className="font-sans-semibold text-[13px] text-bg">{primaryLabel}</Text>
      </Pressable>
    </View>
  );
}
