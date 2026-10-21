import { Text, View } from "react-native";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { SheetBackButton, SheetDangerButton } from "./card-sheet-buttons";

export interface UnlinkMpSheetProps {
  visible: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmación de "Desvincular" (MOVO-112 AC5), con el mismo armado que la de eliminar una
 * tarjeta (prototipo "MOVO-112 Pagos y cobros v3"). Mientras se desvincula no se puede
 * cerrar.
 *
 * El texto no repite el del prototipo ("lo que ya ganaste se acredita igual"): al
 * desvincular se borran los tokens y Movo ya no puede operar los cobros pendientes con esa
 * cuenta (ver `services/movo-svc-payments/CLAUDE.md`, MOVO-111).
 */
export function UnlinkMpSheet({ visible, isPending, onConfirm, onClose }: UnlinkMpSheetProps) {
  const close = () => {
    if (!isPending) onClose();
  };
  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={close}
      testID="unlink-mp-sheet"
      backdropTestID="unlink-mp-sheet-backdrop"
      sheetClassName="rounded-t-2xl bg-bg px-5 pt-5"
      contentClassName="pb-2"
    >
      <Text className="mb-1 font-sans-semibold text-[17px] leading-[22px] text-fg">¿Desvincular Mercado Pago?</Text>
      <Text className="mb-4 font-sans text-[13px] leading-[18px] text-fg-3">
        Sin una cuenta vinculada no vas a poder llevar envíos ni cobrarlos hasta volver a vincularla.
      </Text>
      <View className="gap-2.5 pt-2">
        <SheetDangerButton testID="unlink-mp-sheet-confirm" label="Desvincular" onPress={onConfirm} loading={isPending} />
        <SheetBackButton testID="unlink-mp-sheet-cancel" onPress={close} disabled={isPending} />
      </View>
    </BottomSheetModal>
  );
}
