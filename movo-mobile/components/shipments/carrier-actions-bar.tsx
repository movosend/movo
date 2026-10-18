import { MenuView } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import { MoreVertical } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useState } from "react";
import { Platform, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { CarrierWithdrawSheet } from "./carrier-withdraw-sheet";

const WITHDRAW_ACTION_ID = "withdraw-shipment";

export interface CarrierActionsBarProps {
  shipmentId: string;
  senderFirstName?: string | null;
  onRefetch?: () => void;
  onWithdrawn: (message: string) => void;
  testID?: string;
}

/**
 * Botón de acciones del transportista asignado (MOVO-314): el mismo ícono de tres puntos y menú
 * nativo que `SenderActionsBar`, con una sola acción destructiva, "No puedo hacer este envío",
 * que abre `CarrierWithdrawSheet` (cotización de la deuda y confirmación).
 */
export function CarrierActionsBar({
  shipmentId,
  senderFirstName,
  onRefetch,
  onWithdrawn,
  testID,
}: CarrierActionsBarProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const [isSheetVisible, setIsSheetVisible] = useState(false);

  return (
    <View testID={testID}>
      <MenuView
        testID={testID ? `${testID}-menu` : "carrier-actions-menu"}
        shouldOpenOnLongPress={false}
        isAnchoredToRight
        themeVariant={colorScheme === "dark" ? "dark" : "light"}
        onOpenMenu={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === WITHDRAW_ACTION_ID) setIsSheetVisible(true);
        }}
        actions={[
          {
            id: WITHDRAW_ACTION_ID,
            title: "No puedo hacer este envío",
            titleColor: "#E5484D",
            attributes: { destructive: true },
            image: Platform.select({ ios: "trash", android: "ic_menu_delete" }),
            imageColor: "#E5484D",
          },
        ]}
      >
        <View
          testID={testID ? `${testID}-menu-button` : "carrier-actions-menu-button"}
          accessibilityLabel="Más acciones"
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <MoreVertical size={18} color={colors.fg1} strokeWidth={2} />
        </View>
      </MenuView>

      <CarrierWithdrawSheet
        visible={isSheetVisible}
        shipmentId={shipmentId}
        senderFirstName={senderFirstName}
        onClose={() => setIsSheetVisible(false)}
        onWithdrawn={(message) => {
          setIsSheetVisible(false);
          onWithdrawn(message);
        }}
        onRefetch={onRefetch}
        testID={testID ? `${testID}-sheet` : "carrier-withdraw-sheet"}
      />
    </View>
  );
}
