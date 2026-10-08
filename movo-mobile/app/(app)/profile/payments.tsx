import { router, useFocusEffect } from "expo-router";
import { useColorScheme } from "nativewind";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MpConnectCard, MpConnectSkeletonCard } from "../../../components/payments/mp-connect-card";
import { UnlinkMpSheet } from "../../../components/payments/unlink-mp-sheet";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { useLinkMpAccount, useMpConnectStatus, useUnlinkMpAccount } from "../../../src/hooks/use-mp-connect";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { getInitials } from "../../../src/lib/profile-format";
import { useAuthStore } from "../../../src/store/auth-store";

/**
 * "Pagos y cobros" (MOVO-112), desde Perfil → Configuración. El transportista vincula,
 * consulta y desvincula su cuenta de Mercado Pago (MOVO-111). Fiel al mockup de Claude
 * Design, con dos desvíos:
 *
 * - Un error al vincular (cancelar en MP, deep link con error) es un banner arriba del
 *   estado REAL, que se vuelve a consultar. El mockup siempre volvía a "Sin vincular",
 *   que es falso si la vinculación estaba "inválida" antes de reintentar.
 * - Si falla consultar el status, se muestra el error con "Reintentar" en vez de la
 *   tarjeta (el mockup no tenía este estado).
 */
export default function PaymentsSettingsScreen() {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const fullName = useAuthStore((s) => s.user?.fullName);
  const statusQuery = useMpConnectStatus();
  const link = useLinkMpAccount();
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const unlink = useUnlinkMpAccount({
    onSuccess: () => setUnlinkOpen(false),
    onError: (err) => {
      setUnlinkOpen(false);
      setUnlinkError(friendlyErrorMessage(err, "No pudimos desvincular tu cuenta. Probá de nuevo."));
    },
  });

  // Al volver a la pantalla (ej. desde la app de Mercado Pago) el status puede haber
  // cambiado. Durante un intento de vincular no: ese flujo ya consulta al final.
  const { refetch } = statusQuery;
  const linkPhase = link.phase;
  useFocusEffect(
    useCallback(() => {
      if (linkPhase === "idle") void refetch();
    }, [refetch, linkPhase]),
  );

  const handleLink = () => {
    setUnlinkError(null);
    void link.start();
  };

  const data = statusQuery.data;
  const showFinishing = link.phase === "finishing";

  let content: React.ReactNode;
  if (showFinishing) {
    content = <MpConnectSkeletonCard testID="mp-connect-finishing" message="Terminando la vinculación…" />;
  } else if (data) {
    content = (
      <MpConnectCard
        data={data}
        initials={getInitials(fullName)}
        isDark={colorScheme === "dark"}
        linking={link.phase !== "idle"}
        hadLinkError={link.error !== null}
        onLink={handleLink}
        onUnlink={() => {
          setUnlinkError(null);
          link.clearError();
          setUnlinkOpen(true);
        }}
      />
    );
  } else if (statusQuery.isError) {
    content = (
      <View testID="mp-connect-status-error">
        <ErrorBanner
          message={friendlyErrorMessage(statusQuery.error, "No pudimos consultar tu cuenta de Mercado Pago.")}
        />
        <Pressable
          testID="mp-connect-status-retry"
          onPress={() => void refetch()}
          className="items-center rounded-lg border border-border-strong bg-bg py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-[14px] text-fg">Reintentar</Text>
        </Pressable>
      </View>
    );
  } else {
    content = <MpConnectSkeletonCard testID="mp-connect-loading" message="Consultando el estado de tu cuenta…" />;
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="payments-back"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-[17px] leading-[22px] text-fg">Pagos y cobros</Text>
      </View>

      <ScrollView
        testID="payments-screen-content"
        contentContainerClassName="gap-4 px-5 pb-8 pt-3"
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-sans-semibold text-caption uppercase text-fg-3">Cobros</Text>
        {link.error && !showFinishing ? (
          <View testID="mp-connect-link-error">
            <ErrorBanner message={link.error} />
          </View>
        ) : null}
        {unlinkError ? (
          <View testID="mp-connect-unlink-error">
            <ErrorBanner message={unlinkError} />
          </View>
        ) : null}
        {content}
      </ScrollView>

      <UnlinkMpSheet
        visible={unlinkOpen}
        isPending={unlink.isPending}
        onConfirm={() => unlink.mutate()}
        onClose={() => setUnlinkOpen(false)}
      />
    </SafeAreaView>
  );
}
