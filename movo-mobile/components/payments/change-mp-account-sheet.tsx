import { Text, View } from "react-native";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { SheetBackButton, SheetPrimaryButton } from "./card-sheet-buttons";

export interface ChangeMpAccountSheetProps {
  visible: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Cuando la hoja terminó de cerrarse: iOS no presenta el navegador del OAuth antes. */
  onClosed?: () => void;
}

/**
 * Confirmación de "Cambiar cuenta" (review de MOVO-101, PR #239): vincular otra cuenta pisa el
 * `access_token`/`public_key` de la actual, igual que desvincular, así que lleva el mismo aviso
 * sobre los cobros pendientes (ver `UnlinkMpSheet`).
 */
export function ChangeMpAccountSheet({ visible, onConfirm, onClose, onClosed }: ChangeMpAccountSheetProps) {
  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      onClosed={onClosed}
      testID="change-mp-sheet"
      backdropTestID="change-mp-sheet-backdrop"
      sheetClassName="rounded-t-2xl bg-bg px-5 pt-5"
      contentClassName="pb-2"
    >
      <Text className="mb-1 font-sans-semibold text-[17px] leading-[22px] text-fg">¿Cambiar de cuenta?</Text>
      <Text className="mb-4 font-sans text-[13px] leading-[18px] text-fg-3">
        Al vincular otra cuenta, Movo deja de operar con la actual: los cobros pendientes de envíos asignados o en
        curso podrían no acreditarse. Si tenés alguno, esperá a cobrarlo antes de cambiarla.
      </Text>
      <View className="gap-2.5 pt-2">
        <SheetPrimaryButton testID="change-mp-sheet-confirm" label="Cambiar cuenta" onPress={onConfirm} />
        <SheetBackButton testID="change-mp-sheet-cancel" onPress={onClose} />
      </View>
    </BottomSheetModal>
  );
}
