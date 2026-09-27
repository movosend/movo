import type { BlockedUserSummary } from "@movo/shared/dist/types/user";
import { router } from "expo-router";
import { Ban, ChevronLeft, WifiOff } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BlockImplicationsCard } from "../../../components/profile/block-implications-card";
import { AvatarImage } from "../../../components/ui/avatar-image";
import { SuccessBanner } from "../../../components/ui/success-banner";
import {
  useBlockedUsers,
  useUnblockUser,
} from "../../../src/hooks/use-moderation";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";

/**
 * "Usuarios bloqueados" (MOVO-175, ADR-026), dentro de "Cuenta y seguridad". Solo los
 * bloqueos propios — quién bloqueó al usuario nunca se expone. Desbloquear se
 * confirma con `Alert.alert`, mismo patrón que borrar una dirección (`addresses.tsx`).
 */
export default function BlockedUsersScreen() {
  const colors = useThemeColors();
  const { data: blockedUsers, isLoading, isError, refetch } = useBlockedUsers();
  const unblockMutation = useUnblockUser();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleUnblock = (user: BlockedUserSummary) => {
    Alert.alert(
      `¿Desbloquear a ${user.fullName}?`,
      "Van a poder volver a verse y crear envíos entre ustedes.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desbloquear",
          onPress: () =>
            unblockMutation.mutate(user.id, {
              onSuccess: () =>
                setSuccessMessage(`Desbloqueaste a ${user.fullName}.`),
              onError: (err) =>
                Alert.alert(
                  "No pudimos desbloquear",
                  friendlyErrorMessage(
                    err,
                    "No pudimos completar la acción. Probá de nuevo.",
                  ),
                ),
            }),
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="blocked-users-back"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">
          Usuarios bloqueados
        </Text>
      </View>
      {successMessage ? (
        <View className="px-5">
          <SuccessBanner
            testID="blocked-users-success"
            message={successMessage}
            onDismiss={() => setSuccessMessage(null)}
          />
        </View>
      ) : null}

      {/* Un solo scroll: la card de "qué implica" queda arriba y se ve también con la
          lista vacía, cargando o con error — es justo cuando más sirve explicarlo. */}
      <ScrollView
        testID="blocked-users-content"
        className="flex-1"
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <BlockImplicationsCard />

        <Text className="mb-1 mt-7 font-sans-semibold text-caption uppercase text-fg-3">
          Bloqueados
        </Text>

        {isLoading ? (
          <View className="items-center py-10">
            <ActivityIndicator color={colors.fg3} />
          </View>
        ) : isError ? (
          <View className="items-center gap-2 px-3 py-10">
            <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
            <Text className="text-center font-sans text-body text-fg-2">
              No pudimos cargar tu lista de bloqueados.
            </Text>
            <Text
              testID="blocked-users-retry"
              onPress={() => refetch()}
              className="font-sans-medium text-small text-fg"
            >
              Reintentar
            </Text>
          </View>
        ) : !blockedUsers || blockedUsers.length === 0 ? (
          <View
            testID="blocked-users-empty"
            className="items-center gap-3 px-3 py-10"
          >
            <Ban size={26} strokeWidth={1.8} color={colors.fg3} />
            <Text className="text-center font-sans text-body text-fg-2">
              No bloqueaste a nadie.
            </Text>
            <Text className="text-center font-sans text-small text-fg-3">
              Podés bloquear a alguien desde el menú de su perfil.
            </Text>
          </View>
        ) : (
          <View>
            {blockedUsers.map((user) => (
              <View
                key={user.id}
                testID={`blocked-users-row-${user.id}`}
                className="flex-row items-center gap-3 border-b border-border py-3.5"
              >
                <AvatarImage
                  fullName={user.fullName}
                  photoUrl={user.photoUrl}
                  size={36}
                />
                <Text
                  numberOfLines={1}
                  className="flex-1 font-sans-medium text-[14px] text-fg"
                >
                  {user.fullName}
                </Text>
                <Pressable
                  testID={`blocked-users-row-${user.id}-unblock`}
                  onPress={() => handleUnblock(user)}
                  disabled={unblockMutation.isPending}
                  hitSlop={8}
                  className="rounded-full bg-bg-mute px-3.5 py-2"
                >
                  <Text className="font-sans-medium text-[13px] text-fg">
                    Desbloquear
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
