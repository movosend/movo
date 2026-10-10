import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";

export interface UnlinkMpSheetProps {
  visible: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmación de "Desvincular" (MOVO-112 AC5), fiel al mockup: un sheet propio y no un
 * `Alert`, sobre `BottomSheetModal`. Mientras se desvincula no se puede cerrar.
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
    >
      <Text className="mb-1 font-sans-semibold text-[17px] leading-[22px] text-fg">¿Desvincular Mercado Pago?</Text>
      <Text className="mb-4 font-sans text-[13px] leading-[18px] text-fg-3">
        Si desvinculás tu cuenta, no vas a poder cobrar tus envíos hasta volver a vincularla. ¿Continuar?
      </Text>
      <View className="gap-2.5 pb-2 pt-2">
        <Pressable
          testID="unlink-mp-sheet-confirm"
          accessibilityRole="button"
          accessibilityLabel="Desvincular"
          accessibilityState={{ disabled: isPending, busy: isPending }}
          onPress={onConfirm}
          disabled={isPending}
          className="h-12 items-center justify-center rounded-lg bg-danger-500 active:opacity-80"
        >
          {isPending ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text className="font-sans-semibold text-[15px] text-white">Desvincular</Text>
          )}
        </Pressable>
        <Pressable
          testID="unlink-mp-sheet-cancel"
          accessibilityRole="button"
          accessibilityLabel="Volver"
          accessibilityState={{ disabled: isPending }}
          onPress={close}
          disabled={isPending}
          className="items-center py-2.5"
        >
          <Text className="font-sans-medium text-[15px] text-fg-2">Volver</Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}
