import { KycStatus } from "@movo/shared/dist/types/user";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

const COPY: Partial<Record<KycStatus, { body: string; primaryLabel: string }>> = {
  [KycStatus.NOT_STARTED]: {
    body: "Te falta la licencia de conducir para llevar envíos en auto y mostrar la insignia.",
    primaryLabel: "Subir licencia",
  },
  [KycStatus.PENDING]: {
    body: "Tu verificación de licencia quedó sin terminar. Retomala para completar tu perfil.",
    primaryLabel: "Continuar verificación",
  },
  [KycStatus.MANUAL_REVIEW]: {
    body: "Estamos revisando tu licencia. Te avisamos apenas tengamos una respuesta.",
    primaryLabel: "Ver estado",
  },
  [KycStatus.REJECTED]: {
    body: "No pudimos verificar tu licencia. Revisá los datos e intentá de nuevo.",
    primaryLabel: "Reintentar verificación",
  },
  [KycStatus.EXPIRED]: {
    body: "Tu verificación de licencia venció. Iniciá una nueva para completar tu perfil.",
    primaryLabel: "Reintentar verificación",
  },
};

// Identidad + licencia — para cuando este banner se muestra, la identidad ya está
// aprobada (`roles` solo gana `CARRIER` al cerrar el onboarding, MOVO-98, que exige
// KYC de identidad `approved`), así que el progreso arranca siempre en 1/2.
const TOTAL_STEPS = 2;
const COMPLETED_STEPS = 1;

export interface ProfileLicenseStatusBannerProps {
  status: KycStatus;
  onPrimaryAction: () => void;
  testID?: string;
}

/**
 * Progreso de verificación del perfil (MOVO-15, rediseño post-feedback: "no me
 * gusta lo que tenemos") — reemplaza el banner con ícono + tono warning/danger por
 * rol de KYC (`kyc-status-ui.ts`) por una card neutra de "Perfil verificado X/2" con
 * barra de progreso, mismo lenguaje visual en los 5 estados no-aprobados: solo cambia
 * el texto y la etiqueta del CTA. Se sigue ocultando a sí mismo en `approved` (el
 * badge `license_verified` ya lo comunica).
 *
 * "Después" oculta la card solo por lo que dura el montaje de la pantalla (estado
 * local, sin persistencia) — vuelve a aparecer la próxima vez que se entra a Perfil,
 * a propósito: es un recordatorio de baja fricción, no algo que deba silenciarse para
 * siempre sin que el usuario complete la verificación.
 */
export function ProfileLicenseStatusBanner({ status, onPrimaryAction, testID }: ProfileLicenseStatusBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (status === KycStatus.APPROVED || dismissed) return null;

  const copy = COPY[status];
  if (!copy) return null;

  return (
    <View testID={testID} className="mb-5 gap-3.5 rounded-2xl border border-border bg-bg-sub p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-h3 text-fg">Perfil verificado</Text>
        <Text className="font-sans-semibold text-[13px]" style={{ color: "#9FC72E" }}>
          {COMPLETED_STEPS}/{TOTAL_STEPS}
        </Text>
      </View>

      <View className="h-1.5 flex-row gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
          <View
            key={index}
            className={`h-full flex-1 rounded-full ${index < COMPLETED_STEPS ? "bg-lime-500" : "bg-bg-mute"}`}
          />
        ))}
      </View>

      <Text className="font-sans text-[13.5px] leading-[19px] text-fg-2">{copy.body}</Text>

      <View className="mt-0.5 flex-row items-center gap-4">
        <Pressable
          testID={testID ? `${testID}-primary` : undefined}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPrimaryAction();
          }}
          className="flex-1 items-center rounded-full bg-lime-500 py-3"
        >
          <Text className="font-sans-semibold text-[14px] text-ink-950">{copy.primaryLabel}</Text>
        </Pressable>
        <Pressable
          testID={testID ? `${testID}-dismiss` : undefined}
          onPress={() => setDismissed(true)}
          hitSlop={8}
        >
          <Text className="font-sans-medium text-[14px] text-fg-3">Después</Text>
        </Pressable>
      </View>
    </View>
  );
}
