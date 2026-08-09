import { KycStatus } from '@movo/shared/dist/types/user';
import { ShieldAlert } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../components/auth/primary-button';
import { useAuth } from '../../src/hooks/use-auth';

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
  const bannerText = user ? KYC_BANNER_TEXT[user.kycStatus] : undefined;

  return (
    <SafeAreaView className="flex-1 bg-bg px-6 pt-8" edges={['top', 'bottom']}>
      <Text testID="app-home-welcome" className="mb-1.5 font-sans-semibold text-title text-fg">
        Hola{user?.fullName ? `, ${user.fullName}` : ''}
      </Text>
      <Text className="mb-5 font-sans text-body text-fg-2">
        Ya estás dentro de Movo.
      </Text>

      {bannerText ? (
        <View
          testID="app-home-kyc-banner"
          className="mb-5 flex-row items-start gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3"
        >
          <ShieldAlert size={18} color="#A97714" strokeWidth={1.8} />
          <Text className="flex-1 font-sans text-[13px] text-ink-950">{bannerText}</Text>
        </View>
      ) : null}

      <View className="mt-auto" />
      <PrimaryButton testID="app-home-logout" label="Cerrar sesión" onPress={logout} />
    </SafeAreaView>
  );
}
