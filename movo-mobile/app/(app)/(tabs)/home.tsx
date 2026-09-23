import { KycStatus } from '@movo/shared/dist/types/user';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../../../components/profile/profile-avatar';
import { AttentionSection } from '../../../components/home/attention-section';
import { HomeSendCta } from '../../../components/home/home-send-cta';
import { RecentShipmentsSection } from '../../../components/home/recent-shipments-section';
import { RoleSection } from '../../../components/home/role-section';
import { useReceivingShipments, useSendingShipments } from '../../../src/hooks/use-active-shipments';
import { useAuth } from '../../../src/hooks/use-auth';
import { useMyProfile } from '../../../src/hooks/use-profile';
import { useThemeColors } from '../../../src/hooks/use-theme-colors';
import {
  KYC_TONE_ICON_HEX,
  kycStatusIcon,
  kycStatusTone,
} from '../../../src/lib/kyc-status-ui';
import { capitalizeName, formatGreetingDateLabel, getFirstName } from '../../../src/lib/profile-format';
import { useAuthStore } from '../../../src/store/auth-store';

/**
 * Home del área autenticada (MOVO-83, reemplaza el placeholder de MOVO-76): header
 * tipo navbar nativo (fondo `bg-sub` propio + separador, distinto del `bg` del
 * contenido scrolleable — jerarquía visual, no un `ScrollView` uniforme de punta a
 * punta) con saludo (solo primer nombre — el completo queda para Perfil, que tiene más
 * espacio) + banner de KYC, y debajo: envíos activos por rol (MOVO-193), CTA primaria
 * "Enviar un paquete", tareas pendientes ("Requiere tu atención", MOVO-193) y
 * actividad reciente de envíos propios. El wizard de creación en sí (`/send`) es un
 * ticket aparte — acá solo se resuelve el punto de entrada, bloqueado hasta que el
 * KYC de identidad esté aprobado (mismo criterio que ya usaba el banner).
 *
 * MOVO-193: "Estoy enviando"/"Voy a recibir" (`RoleSection`) consumen `GET
 * /shipments/sending`/`/receiving` (MOVO-192, todavía sin backend — ver
 * `ActiveShipmentSummary` en `shipments-client.ts`); mientras no exista, esas
 * queries fallan y las secciones no se renderizan. "Estoy transportando" queda para
 * una fase 2 de esta misma US (layout distinto, card de viaje agregado, depende de
 * MOVO-206).
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
  const { user } = useAuth();
  const { data: profile } = useMyProfile();
  const colors = useThemeColors();
  const { data: sending } = useSendingShipments();
  const { data: receiving } = useReceivingShipments();

  // El perfil fresco del backend prevalece sobre el snapshot estático del login
  const currentKycStatus = profile?.kycStatus ?? user?.kycStatus;

  // Si el perfil fresco reporta un kycStatus distinto al almacenado localmente, sincronizamos authStore
  useEffect(() => {
    if (profile?.kycStatus && user?.kycStatus && profile.kycStatus !== user.kycStatus) {
      void useAuthStore.getState().updateKycStatus(profile.kycStatus);
    }
  }, [profile?.kycStatus, user?.kycStatus]);

  const bannerText = currentKycStatus ? KYC_BANNER_TEXT[currentKycStatus] : undefined;
  const tone = currentKycStatus ? kycStatusTone(currentKycStatus) : "warning";
  const BannerIcon = currentKycStatus ? kycStatusIcon(currentKycStatus) : undefined;
  const bannerIconColor = tone === "neutral" ? colors.fg2 : KYC_TONE_ICON_HEX[tone === "success" ? "warning" : tone];

  // `PrivateProfile.firstName` (GET /users/me) es el dato real de la API — se prefiere
  // sobre partir `fullName` a mano. El fallback solo cubre el instante entre el mount
  // y que resuelva `useMyProfile()`: la sesión de login/refresh (`SessionResponse`,
  // `auth-store.ts`) nunca trajo `firstName` separado, solo `fullName`.
  const firstName = profile?.firstName ? capitalizeName(profile.firstName) : getFirstName(user?.fullName);
  const fullName = profile?.fullName ? capitalizeName(profile.fullName) : capitalizeName(user?.fullName);
  const dateLabel = formatGreetingDateLabel(new Date());

  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["shipments"] }),
      queryClient.invalidateQueries({ queryKey: ["users", "me"] }),
      queryClient.invalidateQueries({ queryKey: ["attention-tasks"] }),
    ]);
    setRefreshing(false);
  };

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView className="border-b border-border bg-bg-sub" edges={['top']}>
        <View className="flex-row items-center justify-between px-6 pb-4 pt-3">
          <View className="flex-1 pr-4">
            <Text
              testID="app-home-date"
              className="font-sans text-[12px] tracking-wider text-fg-3"
            >
              {dateLabel}
            </Text>
            <Text testID="app-home-welcome" className="font-sans-semibold text-title text-fg">
              Hola{firstName ? `, ${firstName}` : ''}
            </Text>
          </View>
          <Pressable
            testID="app-home-avatar"
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel="Ir a Mi perfil"
          >
            <ProfileAvatar fullName={fullName} photoUrl={profile?.photoUrl ?? null} size={44} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerClassName="px-6 pb-32 pt-6"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            testID="app-home-refresh-control"
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.fg1}
            progressViewOffset={32}
            style={{ marginTop: 8 }}
          />
        }
      >
        {bannerText && BannerIcon ? (
          <View
            testID="app-home-kyc-banner"
            className="mb-6 flex-row items-start gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3"
          >
            <BannerIcon size={18} color={bannerIconColor} strokeWidth={1.8} />
            <Text className="flex-1 font-sans text-[13px] text-ink-950">{bannerText}</Text>
          </View>
        ) : null}

        <RoleSection
          testID="app-home-sending"
          title="Estoy enviando"
          role="sending"
          shipments={sending ?? []}
        />
        <RoleSection
          testID="app-home-receiving"
          title="Voy a recibir"
          role="receiving"
          shipments={receiving ?? []}
        />

        <HomeSendCta testID="app-home-send-cta" kycStatus={currentKycStatus} />

        <AttentionSection testID="app-home-attention" />

        <RecentShipmentsSection testID="app-home-recent-shipments" />
      </ScrollView>
    </View>
  );
}
