import { KycStatus } from '@movo/shared/dist/types/user';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../../components/auth/primary-button';
import { useAuth } from '../../../src/hooks/use-auth';
import { useThemeColors } from '../../../src/hooks/use-theme-colors';
import {
  KYC_TONE_ICON_HEX,
  kycStatusIcon,
  kycStatusTone,
} from '../../../src/lib/kyc-status-ui';

/**
 * Home placeholder del área autenticada (MOVO-76) — no hay todavía ninguna pantalla
 * real post-login (perfil es MOVO-78, envíos MOVO-83+). Alcanza para probar
 * guard/refresh/logout de punta a punta: bienvenida, aviso de KYC si corresponde
 * (AC11), y logout (AC10).
 */
const KYC_BANNER_TEXT: Partial<Record<KycStatus, string>> = {
  [KycStatus.NOT_STARTED]: 'Todavía no verificaste tu identidad. Mientras tanto, tu acceso está restringido.',
  [KycStatus.PENDING]: 'Tu verificación de identidad está en curso. Mientras tanto, tu acceso está restringido.',
  [KycStatus.MANUAL_REVIEW]:
    'Tu verificación de identidad está en revisión manual. Mientras tanto, tu acceso está restringido.',
  [KycStatus.REJECTED]:
    'Tu verificación de identidad fue rechazada. Mientras tanto, tu acceso está restringido.',
  [KycStatus.EXPIRED]:
    'Tu verificación de identidad venció y hay que reintentarla. Mientras tanto, tu acceso está restringido.',
};

export default function AuthenticatedHomeScreen() {
  const { user, logout } = useAuth();
  const colors = useThemeColors();
  const bannerText = user ? KYC_BANNER_TEXT[user.kycStatus] : undefined;
  // Ícono/color por estado (src/lib/kyc-status-ui.ts, MOVO-78) en vez del `ShieldAlert`
  // fijo de antes — mismo criterio visual que `kyc.tsx#RESULT_BADGE` y el badge de
  // perfil, para que las 3 instancias donde se ve estado de KYC queden consistentes.
  // El marco del banner (borde/fondo) se mantiene en warning para todos los casos que
  // llegan acá: ningún valor de `KYC_BANNER_TEXT` es `APPROVED`, y el mensaje siempre es
  // "tu acceso está restringido", no una alerta de rechazo — solo el ícono diferencia.
  const tone = user ? kycStatusTone(user.kycStatus) : "warning";
  const BannerIcon = user ? kycStatusIcon(user.kycStatus) : undefined;
  const bannerIconColor = tone === "neutral" ? colors.fg2 : KYC_TONE_ICON_HEX[tone === "success" ? "warning" : tone];

  return (
    <SafeAreaView className="flex-1 bg-bg px-6 pt-8" edges={['top', 'bottom']}>
      <Text testID="app-home-welcome" className="mb-1.5 font-sans-semibold text-title text-fg">
        Hola{user?.fullName ? `, ${user.fullName}` : ''}
      </Text>
      <Text className="mb-5 font-sans text-body text-fg-2">
        Ya estás dentro de Movo.
      </Text>

      {bannerText && BannerIcon ? (
        <View
          testID="app-home-kyc-banner"
          className="mb-5 flex-row items-start gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3"
        >
          <BannerIcon size={18} color={bannerIconColor} strokeWidth={1.8} />
          <Text className="flex-1 font-sans text-[13px] text-ink-950">{bannerText}</Text>
        </View>
      ) : null}

      <View className="mt-auto" />
      <PrimaryButton testID="app-home-logout" label="Cerrar sesión" onPress={logout} />
    </SafeAreaView>
  );
}
