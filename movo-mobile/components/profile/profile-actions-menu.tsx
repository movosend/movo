import { MenuView } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { MoreVertical } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Alert, Platform, View } from "react-native";
import { useBlockUser, usePendingReport, useUnblockUser } from "../../src/hooks/use-moderation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";

const REPORT_ACTION_ID = "report-user";
const BLOCK_ACTION_ID = "block-user";
const UNBLOCK_ACTION_ID = "unblock-user";

export interface ProfileActionsMenuProps {
  userId: string;
  fullName: string;
  /** `PublicProfile.isBlockedByMe` — alterna la acción entre "Bloquear" y "Desbloquear". */
  isBlockedByMe?: boolean;
  /** Confirmación de bloquear/desbloquear, para que la pantalla la muestre con `SuccessBanner`. */
  onActionSuccess?: (message: string) => void;
  testID?: string;
}

/**
 * Menú "Reportar/Bloquear" del rediseño de perfil (MOVO-175, ADR-026). Reusa el patrón
 * exacto de `MenuView` de `components/shipments/sender-actions-bar.tsx` (MOVO-29):
 * menú nativo (`UIMenu`/`PopupMenu`), y `Alert.alert` nativo como último paso de la
 * confirmación de bloqueo (mismo criterio que la baja de cuenta, MOVO-136). Reportar
 * navega a `profile/[id]/report`; con un reporte propio en revisión (que la pantalla
 * de perfil ya pidió en paralelo) la acción dice "Ver tu reporte".
 */
export function ProfileActionsMenu({
  userId,
  fullName,
  isBlockedByMe = false,
  onActionSuccess,
  testID,
}: ProfileActionsMenuProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();

  const pendingReportQuery = usePendingReport(userId);
  const hasPendingReport = !!pendingReportQuery.data;
  const blockMutation = useBlockUser(userId);
  const unblockMutation = useUnblockUser();

  const isBusy = blockMutation.isPending || unblockMutation.isPending;

  function resolveErrorMessage(error: unknown): string {
    return friendlyErrorMessage(error, "No pudimos completar la acción. Probá de nuevo.");
  }

  function confirmBlock() {
    Alert.alert(
      `¿Bloquear a ${fullName}?`,
      // El detalle de qué implica un bloqueo vive en la pantalla de bloqueados
      // (`BlockImplicationsCard`); acá solo se dice dónde revertirlo.
      "Podés revertirlo cuando quieras desde Configuración › Cuenta y seguridad › Usuarios bloqueados.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Bloquear",
          style: "destructive",
          onPress: () => {
            blockMutation.mutate(undefined, {
              onSuccess: () => onActionSuccess?.(`Bloqueaste a ${fullName}.`),
              onError: (err) => Alert.alert("No pudimos bloquear", resolveErrorMessage(err)),
            });
          },
        },
      ],
    );
  }

  function confirmUnblock() {
    Alert.alert(`¿Desbloquear a ${fullName}?`, "Van a poder volver a verse y crear envíos entre ustedes.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Desbloquear",
        onPress: () => {
          unblockMutation.mutate(userId, {
            onSuccess: () => onActionSuccess?.(`Desbloqueaste a ${fullName}.`),
            onError: (err) => Alert.alert("No pudimos desbloquear", resolveErrorMessage(err)),
          });
        },
      },
    ]);
  }

  return (
    <View testID={testID}>
      <View
        testID={testID ? `${testID}-menu-wrapper` : "profile-actions-menu-wrapper"}
        pointerEvents={isBusy ? "none" : "auto"}
        style={{ opacity: isBusy ? 0.5 : 1 }}
      >
        <MenuView
          testID={testID ? `${testID}-menu` : "profile-actions-menu"}
          shouldOpenOnLongPress={false}
          isAnchoredToRight
          themeVariant={colorScheme === "dark" ? "dark" : "light"}
          onOpenMenu={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === REPORT_ACTION_ID) router.push(`/profile/${userId}/report`);
            if (nativeEvent.event === BLOCK_ACTION_ID) confirmBlock();
            if (nativeEvent.event === UNBLOCK_ACTION_ID) confirmUnblock();
          }}
          actions={[
            {
              id: REPORT_ACTION_ID,
              title: hasPendingReport ? "Ver tu reporte" : `Reportar a ${fullName}`,
              image: Platform.select({ ios: "flag", android: "ic_menu_report_image" }),
              // Sin `imageColor` explícito el ícono queda sin tinte (invisible en la
              // práctica) — a diferencia de "Bloquear", que sí lo tenía por ser
              // destructivo. `colors.fg1` para que se vea igual que el texto de la
              // fila en los dos temas.
              imageColor: colors.fg1,
            },
            isBlockedByMe
              ? {
                  id: UNBLOCK_ACTION_ID,
                  title: "Desbloquear",
                  image: Platform.select({ ios: "hand.raised.slash", android: "ic_menu_revert" }),
                  imageColor: colors.fg1,
                }
              : {
                  id: BLOCK_ACTION_ID,
                  title: "Bloquear",
                  titleColor: "#E5484D",
                  attributes: { destructive: true },
                  image: Platform.select({ ios: "hand.raised", android: "ic_menu_close_clear_cancel" }),
                  imageColor: "#E5484D",
                },
          ]}
        >
          <View
            testID={testID ? `${testID}-menu-button` : "profile-actions-menu-button"}
            accessibilityLabel="Más acciones"
            className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          >
            <MoreVertical size={18} color={colors.fg1} strokeWidth={2} />
          </View>
        </MenuView>
      </View>

    </View>
  );
}
