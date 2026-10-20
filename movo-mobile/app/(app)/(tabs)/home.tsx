import { KycStatus, UserRole } from '@movo/shared/dist/types/user';
import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HomeChatButton } from '../../../components/chat/home-chat-button';
import { ProfileAvatar } from '../../../components/profile/profile-avatar';
import { AttentionSection } from '../../../components/home/attention-section';
import { CarrierTransportingSection } from '../../../components/home/carrier-transporting-section';
import { HomeSendCta } from '../../../components/home/home-send-cta';
import { RecentShipmentsSection } from '../../../components/home/recent-shipments-section';
import { RoleSection } from '../../../components/home/role-section';
import { SuccessBanner } from '../../../components/ui/success-banner';
import { TrackingActiveIndicator } from '../../../components/location/tracking-active-indicator';
import { useReceivingShipments, useSendingShipments } from '../../../src/hooks/use-active-shipments';
import { useAuth } from '../../../src/hooks/use-auth';
import { useAutoStartTour } from '../../../src/hooks/use-auto-start-tour';
import { useChatList } from '../../../src/hooks/use-chat';
import { useMyProfile } from '../../../src/hooks/use-profile';
import { useThemeColors } from '../../../src/hooks/use-theme-colors';
import { useTransportGate } from '../../../src/hooks/use-transport-gate';
import {
  KYC_TONE_ICON_HEX,
  kycStatusIcon,
  kycStatusTone,
} from '../../../src/lib/kyc-status-ui';
import { capitalizeName, formatGreetingDateLabel, getFirstName } from '../../../src/lib/profile-format';
import { useAuthStore } from '../../../src/store/auth-store';
import { useTabBarScrollHandler } from '../../../src/store/tab-bar-store';

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
 * /shipments/sending`/`/receiving` (MOVO-192, ya desplegado — ver
 * `ActiveShipmentSummary` en `shipments-client.ts`); cada sección carga y falla por su
 * cuenta (MOVO-168), con skeleton y "Reintentar" locales. `CarrierTransportingSection`
 * (MOVO-252) usa `GET /shipments/transporting` y `GET /trips` para la sección
 * "Estoy transportando", que solo se monta para el rol `CARRIER`.
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
  const tabBarScroll = useTabBarScrollHandler();
  const { user } = useAuth();
  const { data: profile } = useMyProfile();
  const colors = useThemeColors();
  const sendingQuery = useSendingShipments();
  const sending = sendingQuery.data;
  const receivingQuery = useReceivingShipments();
  const receiving = receivingQuery.data;
  const { data: chats } = useChatList();
  // Solo los envíos que ya tienen chat llevan el botón en su card.
  const chatByShipment = Object.fromEntries((chats ?? []).map((item) => [item.shipmentId, { unreadCount: item.unreadCount }]));

  // El perfil fresco del backend prevalece sobre el snapshot estático del login
  const currentKycStatus = profile?.kycStatus ?? user?.kycStatus;

  // Si el perfil fresco reporta un kycStatus distinto al almacenado localmente, sincronizamos authStore
  useEffect(() => {
    if (profile?.kycStatus && user?.kycStatus && profile.kycStatus !== user.kycStatus) {
      void useAuthStore.getState().updateKycStatus(profile.kycStatus);
    }
  }, [profile?.kycStatus, user?.kycStatus]);

  // Skeleton y error de "Estoy transportando" solo le corresponden a quien es transportista.
  const isCarrier = (profile?.roles ?? user?.roles)?.includes(UserRole.CARRIER) ?? false;

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

  // MOVO-314: el detalle del envío vuelve acá cuando el transportista se baja de un envío, con el
  // aviso en `withdrawnNotice`. `withdrawnAt` lo hace único: dos bajas seguidas con el mismo texto
  // no volverían a armar el banner.
  const { withdrawnNotice, withdrawnAt } = useLocalSearchParams<{ withdrawnNotice?: string; withdrawnAt?: string }>();
  const [withdrawnMessage, setWithdrawnMessage] = useState<string | null>(withdrawnNotice ?? null);
  useEffect(() => {
    if (withdrawnNotice) setWithdrawnMessage(withdrawnNotice);
  }, [withdrawnNotice, withdrawnAt]);

  // MOVO-169: Tour 1 "Primeros pasos" en la primera llegada con la identidad aprobada
  // (sin ella no se puede enviar). Espera a saber si ya puede transportar: decide el último paso.
  const isFocused = useIsFocused();
  const { canBrowse, isRequirementsLoading } = useTransportGate();
  useAutoStartTour('first_steps', {
    enabled: isFocused && currentKycStatus === KycStatus.APPROVED && !isRequirementsLoading,
    delayMs: 700,
    context: { firstName: firstName ?? null, canBrowse },
  });
  const scrollRef = useRef<ScrollView>(null);
  const scrollTourAnchorIntoView = (layoutY: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, layoutY - 16), animated: true });
  };

  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["shipments"] }),
      queryClient.invalidateQueries({ queryKey: ["trips"] }),
      queryClient.invalidateQueries({ queryKey: ["users", "me"] }),
      queryClient.invalidateQueries({ queryKey: ["attention-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["chat", "list"] }),
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
          <View className="flex-row items-center gap-3">
          <HomeChatButton />
          <Pressable
            testID="app-home-avatar"
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel="Ir a Mi perfil"
          >
            <ProfileAvatar fullName={fullName} photoUrl={profile?.photoUrl ?? null} size={44} />
          </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        ref={scrollRef}
        {...tabBarScroll}
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
        {withdrawnMessage ? (
          <View className="mb-6">
            <SuccessBanner
              message={withdrawnMessage}
              onDismiss={() => setWithdrawnMessage(null)}
              testID="app-home-withdrawn-banner"
            />
          </View>
        ) : null}

        {bannerText && BannerIcon ? (
          <View
            testID="app-home-kyc-banner"
            className="mb-6 flex-row items-start gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3"
          >
            <BannerIcon size={18} color={bannerIconColor} strokeWidth={1.8} />
            <Text className="flex-1 font-sans text-[13px] text-ink-950">{bannerText}</Text>
          </View>
        ) : null}

        <TrackingActiveIndicator />

        {isCarrier ? <CarrierTransportingSection testID="app-home-transporting" /> : null}

        <RoleSection
          testID="app-home-sending"
          title="Estoy enviando"
          role="sending"
          shipments={sending ?? []}
          chatByShipment={chatByShipment}
          isLoading={sendingQuery.isLoading}
          isError={sendingQuery.isError}
          onRetry={() => void sendingQuery.refetch()}
        />
        <RoleSection
          testID="app-home-receiving"
          title="Voy a recibir"
          role="receiving"
          shipments={receiving ?? []}
          chatByShipment={chatByShipment}
          isLoading={receivingQuery.isLoading}
          isError={receivingQuery.isError}
          onRetry={() => void receivingQuery.refetch()}
        />

        <HomeSendCta
          testID="app-home-send-cta"
          kycStatus={currentKycStatus}
          scrollIntoView={scrollTourAnchorIntoView}
        />

        <AttentionSection testID="app-home-attention" />

        <RecentShipmentsSection testID="app-home-recent-shipments" scrollIntoView={scrollTourAnchorIntoView} />
      </ScrollView>
    </View>
  );
}
