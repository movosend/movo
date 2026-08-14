import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { PhotoPicker } from '../../../components/profile/photo-picker';
import { ProfileBadges } from '../../../components/profile/profile-badges';
import { ProfileErrorState } from '../../../components/profile/profile-error-state';
import { ProfileKycStatusBanner } from '../../../components/profile/profile-kyc-status-banner';
import { ProfileLogoutButton } from '../../../components/profile/profile-logout-button';
import { ProfilePrivateSection } from '../../../components/profile/profile-private-section';
import { ProfileSettingsSection } from '../../../components/profile/profile-settings-section';
import { ProfileSkeleton } from '../../../components/profile/profile-skeleton';
import { ProfileStatsRow } from '../../../components/profile/profile-stats-row';
import { ProfileVerifiedBadge } from '../../../components/profile/profile-verified-badge';
import { useAuth } from '../../../src/hooks/use-auth';
import { useMyProfile } from '../../../src/hooks/use-profile';
import { friendlyErrorMessage } from '../../../src/lib/error-messages';

/**
 * Pantalla de perfil propio (MOVO-78, tab "Ajustes"). Compone las piezas de
 * `components/profile/` sobre el resultado de `useMyProfile()` (`GET /users/me`,
 * MOVO-77 backend, ya Done).
 */
export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const { data, isLoading, isError, error, refetch } = useMyProfile();

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

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        testID="profile-screen-content"
        contentContainerClassName="px-6 pb-32 pt-8"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-6 flex-row items-center gap-3">
          <PhotoPicker
            testID="profile-photo-picker"
            fullName={data.fullName}
            currentPhotoUrl={data.photoUrl}
            size={56}
            onPhotoUpdated={() => {
              void queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
            }}
          />
          <View className="flex-1">
            <Text testID="profile-full-name" className="font-sans-semibold text-h2 text-fg">
              {data.fullName}
            </Text>
            {data.badges.includes('kyc_verified') && (
              <ProfileVerifiedBadge testID="profile-verified-badge" />
            )}
          </View>
        </View>

        <ProfileKycStatusBanner
          testID="profile-kyc-banner"
          status={data.kycStatus}
          onPrimaryAction={() => router.push('/kyc')}
        />

        <ProfileStatsRow
          testID="profile-stats-row"
          transactionCounts={data.transactionCounts}
          reputationScore={data.reputationScore}
        />

        <ProfileBadges
          testID="profile-badges"
          badges={data.badges.filter((badge) => badge !== 'kyc_verified')}
        />

        <ProfilePrivateSection testID="profile-private-section" email={data.email} phone={data.phone} />

        <ProfileSettingsSection testID="profile-settings-section" />

        <ProfileLogoutButton testID="profile-logout-button" onPress={logout} />

        <Text className="mt-6 text-center font-sans text-caption text-fg-3">
          Movo · v{Constants.expoConfig?.version ?? '?'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
