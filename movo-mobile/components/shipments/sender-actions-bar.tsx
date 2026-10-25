import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { MenuView } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import { MoreVertical } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useState } from "react";
import { Platform, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { CancelShipmentSheet } from "./cancel-shipment-sheet";

const CANCEL_ACTION_ID = "cancel-shipment";

export interface SenderActionsBarProps {
  shipment: Pick<ShipmentSummary, "id" | "status" | "agreedPriceArs">;
  /** Monto real reservado en el hold (MOVO-318); cae a `agreedPriceArs` si no cargó. */
  holdAmountArs?: number | null;
  holdState?: "loading" | "error" | "ready";
  onRetryHold?: () => void;
  carrierFirstName?: string | null;
  /** Refresca el detalle y devuelve el estado nuevo (ante un 409 de estado del sheet). */
  onRefetch: () => Promise<ShipmentStatus | undefined>;
  onCancelled: (message: string) => void;
  testID?: string;
}

/**
 * Botón de acciones del emisor (MOVO-29): un ícono de tres puntos en el header
 * (junto a `ShipmentStatusBadge`) que abre el menú desplegable **nativo** de la
 * plataforma (`UIMenu` en iOS 14+/`PopupMenu` en Android, vía
 * `@react-native-menu/menu`) — tercera vuelta de feedback tras dos versiones
 * caseras: una barra fija al pie (rechazada, "esa franja debería estar libre") y
 * un ícono que abría el modal de cancelación directo (rechazado, "poco intuitivo").
 * Un desplegable hecho a mano (`Modal` + card con blur) todavía se sentía "berreta"
 * — con dev client ya andando, se optó por el componente nativo real en vez de
 * seguir afinando CSS. Hoy con una sola acción (`Cancelar envío`, atributo
 * `destructive` nativo — rojo automático en iOS, `titleColor` explícito en
 * Android), pero el array de `actions` ya admite sumar más sin rehacer nada.
 *
 * - Elegir "Cancelar envío" abre `CancelShipmentSheet` (MOVO-308): cotización de la
 *   penalidad, motivo opcional y confirmación, con sus estados de error adentro del sheet.
 */
export function SenderActionsBar({
  shipment,
  holdAmountArs,
  holdState,
  onRetryHold,
  carrierFirstName,
  onRefetch,
  onCancelled,
  testID,
}: SenderActionsBarProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const [isCancelSheetVisible, setIsCancelSheetVisible] = useState(false);

  return (
    <View testID={testID}>
      <MenuView
        testID={testID ? `${testID}-menu` : "sender-actions-menu"}
        shouldOpenOnLongPress={false}
        isAnchoredToRight
        themeVariant={colorScheme === "dark" ? "dark" : "light"}
        onOpenMenu={() =>
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        }
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === CANCEL_ACTION_ID) {
            setIsCancelSheetVisible(true);
          }
        }}
        actions={[
          {
            id: CANCEL_ACTION_ID,
            title: "Cancelar envío",
            titleColor: "#E5484D",
            attributes: { destructive: true },
            image: Platform.select({
              ios: "trash",
              android: "ic_menu_delete",
            }),
            imageColor: "#E5484D",
          },
        ]}
      >
        <View
          testID={
            testID ? `${testID}-menu-button` : "sender-actions-menu-button"
          }
          accessibilityLabel="Más acciones"
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <MoreVertical size={18} color={colors.fg1} strokeWidth={2} />
        </View>
      </MenuView>

      <CancelShipmentSheet
        visible={isCancelSheetVisible}
        shipment={shipment}
        holdAmountArs={holdAmountArs}
        holdState={holdState}
        onRetryHold={onRetryHold}
        carrierFirstName={carrierFirstName}
        onClose={() => setIsCancelSheetVisible(false)}
        onCancelled={(message) => {
          setIsCancelSheetVisible(false);
          onCancelled(message);
        }}
        onRefetch={onRefetch}
        testID={testID ? `${testID}-cancel-sheet` : "sender-cancel-sheet"}
      />
    </View>
  );
}
