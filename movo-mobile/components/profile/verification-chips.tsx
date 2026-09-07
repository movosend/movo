import { CheckCircle2, IdCard, Mail, Phone } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

export interface VerificationChipsProps {
  isIdentityVerified: boolean;
  isLicenseVerified: boolean;
  /** MOVO-170, todavía sin backend — `undefined` oculta el chip entero en vez de
   * mostrarlo "no verificado" con un dato que hoy no existe. */
  isPhoneVerified?: boolean;
  isEmailVerified?: boolean;
  testID?: string;
}

interface Chip {
  key: string;
  label: string;
}

/**
 * Fila de chips de verificación del rediseño de perfil — solo lista lo que el
 * backend efectivamente distingue (identidad, licencia, y desde MOVO-170 teléfono/
 * email). A propósito **no** desglosa identidad en "DNI"/"Selfie" por separado
 * como sugiere el prototipo: el KYC es un único resultado pass/fail por tipo
 * (`kycStatusIdentity`), mostrar sub-pasos sería aparentar una precisión que el
 * sistema no tiene. Solo se listan verificaciones reales, nunca "no verificado" —
 * mismo criterio que el resto del perfil (MOVO-154): ausencia de dato no se
 * muestra como negativo.
 */
export function VerificationChips({
  isIdentityVerified,
  isLicenseVerified,
  isPhoneVerified,
  isEmailVerified,
  testID,
}: VerificationChipsProps) {
  const chips: Chip[] = [];
  if (isIdentityVerified) chips.push({ key: "identity", label: "Identidad" });
  if (isLicenseVerified) chips.push({ key: "license", label: "Licencia" });
  if (isPhoneVerified) chips.push({ key: "phone", label: "Teléfono" });
  if (isEmailVerified) chips.push({ key: "email", label: "Email" });

  if (chips.length === 0) return null;

  const ICONS: Record<string, typeof CheckCircle2> = {
    identity: CheckCircle2,
    license: IdCard,
    phone: Phone,
    email: Mail,
  };

  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-1.5"
    >
      {chips.map(({ key, label }) => {
        const Icon = ICONS[key]!;
        return (
          <View
            key={key}
            testID={testID ? `${testID}-${key}` : undefined}
            className="flex-row items-center gap-1.5 rounded-full border border-border bg-bg-sub px-3 py-1.5"
          >
            <Icon size={12} strokeWidth={2.4} color="#2BB673" />
            <Text className="font-sans-medium text-[12px] text-fg">{label}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
