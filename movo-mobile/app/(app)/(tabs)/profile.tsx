import { KycStatus, UserRole } from '@movo/shared/dist/types/user';
import { Pencil } from 'lucide-react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../../../components/profile/profile-avatar';
import { ProfileBadges } from '../../../components/profile/profile-badges';
import { ProfileErrorState } from '../../../components/profile/profile-error-state';
import { ProfileLicenseStatusBanner } from '../../../components/profile/profile-license-status-banner';
import { ProfileLogoutButton } from '../../../components/profile/profile-logout-button';
import { ProfileSettingsSection } from '../../../components/profile/profile-settings-section';
import { ProfileSkeleton } from '../../../components/profile/profile-skeleton';
import { ProfileStatsRow } from '../../../components/profile/profile-stats-row';
import { ReputationDetail } from '../../../components/profile/reputation-detail';
import { useAuth } from '../../../src/hooks/use-auth';
import { useThemeColors } from '../../../src/hooks/use-theme-colors';
import { useMyProfile, usePublicProfile } from '../../../src/hooks/use-profile';
import { friendlyErrorMessage } from '../../../src/lib/error-messages';
import { capitalizeName } from '../../../src/lib/profile-format';

/**
 * Pantalla de perfil propio (MOVO-78, tab "Ajustes"). Compone las piezas de
 * `components/profile/` sobre el resultado de `useMyProfile()` (`GET /users/me`,
 * MOVO-77 backend, ya Done).
 */
export default function ProfileScreen() {
  const colors = useThemeColors();
  const { logout } = useAuth();
  const { data, isLoading, isError, error, refetch } = useMyProfile();
  // Desglose/comentarios de reputación (MOVO-154, AC2/AC3/AC5/AC6) no viven en
  // `PrivateProfile` (MOVO-152: solo `PublicProfile` los tiene) — se resuelven con
  // una segunda query, propia y degradable, sin bloquear el resto del perfil si
  // falla. `GET /users/:id` no distingue self-lookup de cualquier otro (verificado
  // en `users.routes.ts`), así que no hace falta un endpoint nuevo.
  const { data: publicProfile } = usePublicProfile(data?.id);

  if (isLoading) return <ProfileSkeleton testID="profile-skeleton" />;

  if (isError || !data) {
    return (
      <ProfileErrorState
        testID="profile-error-state"
        message={friendlyErrorMessage(error, 'No pudimos conectar con el servidor.')}
        onRetry={() => refetch()}
      />
    );
  }

  const displayName = capitalizeName(data.fullName);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        testID="profile-screen-content"
        contentContainerClassName="px-6 pb-32 pt-8"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-6 flex-row items-center gap-4">
          <ProfileAvatar
            testID="profile-avatar"
            fullName={displayName}
            photoUrl={data.photoUrl}
            size={88}
          />
          <View className="flex-1">
            <Text testID="profile-full-name" className="font-sans-semibold text-h2 text-fg">
              {displayName}
            </Text>
            <ProfileBadges
              testID="profile-badges"
              kycVerified={data.badges.includes('kyc_verified') || data.kycStatus === KycStatus.APPROVED}
              licenseVerified={data.badges.includes('license_verified') || data.licenseKycStatus === KycStatus.APPROVED}
              showLicense={data.roles.includes(UserRole.CARRIER) || data.badges.includes('license_verified')}
            />
          </View>
          {/* AC1 de MOVO-135: la edición del perfil se alcanza en un tap desde acá,
              no desde la lista de Configuración (ahí vive "Cuenta y seguridad",
              que es contraseña y baja de cuenta — MOVO-136). */}
          <Pressable
            testID="profile-edit-button"
            onPress={() => router.push('/profile/edit')}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
          >
            <Pencil size={15} color={colors.fg2} strokeWidth={1.8} />
          </Pressable>
        </View>

        {data.roles.includes(UserRole.CARRIER) && (
          <ProfileLicenseStatusBanner
            testID="profile-license-banner"
            status={data.licenseKycStatus}
            onPrimaryAction={() =>
              router.push({
                pathname: '/license-kyc',
                params: { status: data.licenseKycStatus },
              })
            }
          />
        )}

        <ProfileStatsRow
          testID="profile-stats-row"
          transactionCounts={data.transactionCounts}
          reputationScore={data.reputationScore}
          isNewProfile={publicProfile?.isNewProfile}
        />

        {publicProfile ? (
          <View className="mb-6">
            <ReputationDetail
              testID="profile-reputation-detail"
              asSender={publicProfile.asSender}
              asCarrier={publicProfile.asCarrier}
              recentRatingComments={publicProfile.recentRatingComments}
            />
          </View>
        ) : null}

        <ProfileSettingsSection testID="profile-settings-section" />

        <ProfileLogoutButton testID="profile-logout-button" onPress={logout} />

        <Text className="mt-6 text-center font-sans text-caption text-fg-3">
          Movo · v{Constants.expoConfig?.version ?? '?'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
