import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { Text, View } from "react-native";
import { deleteCardBody, deleteCardTitle } from "../../src/lib/saved-cards";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { SheetBackButton, SheetDangerButton } from "./card-sheet-buttons";

interface DeleteCardSheetProps {
  card: SavedCard | null;
  cards: SavedCard[];
  visible: boolean;
  isPending: boolean;
  /**
   * Error de la baja, dentro de la hoja. Con `409 CARD_IN_USE` la tarjeta sigue en la lista
   * y el botón se apaga: reintentar no sirve hasta que se libere la reserva.
   */
  error: string | null;
  inUse: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onClosed?: () => void;
}

/**
 * Confirmación de baja (MOVO-101 AC5), fiel al prototipo. El aviso de reserva vigente
 * (`409 CARD_IN_USE`) no está en el prototipo: usa el mismo banner rojo que la nota de
 * tarjeta vencida.
 */
export function DeleteCardSheet({
  card,
  cards,
  visible,
  isPending,
  error,
  inUse,
  onConfirm,
  onClose,
  onClosed,
}: DeleteCardSheetProps) {
  const close = () => {
    if (!isPending) onClose();
  };

  return (
    <BottomSheetModal
      visible={visible && !!card}
      onRequestClose={close}
      testID="delete-card-sheet"
      backdropTestID="delete-card-sheet-backdrop"
      sheetClassName="rounded-t-2xl bg-bg px-5 pt-5"
      contentClassName="pb-2"
      onClosed={onClosed}
    >
      {card ? (
        <>
          <Text className="mb-1 font-sans-semibold text-[17px] leading-[22px] text-fg">{deleteCardTitle(card)}</Text>
          <Text testID="delete-card-body" className="mb-4 font-sans text-[13px] leading-[18px] text-fg-3">
            {deleteCardBody(cards, card)} Los envíos que ya tienen fondos reservados no cambian.
          </Text>
          {error ? (
            <View
              testID="delete-card-error"
              className="mb-2 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
            >
              <Text className="font-sans text-[12.5px] leading-[18px] text-ink-950">{error}</Text>
            </View>
          ) : null}
          <View className="gap-2.5 pt-2">
            <SheetDangerButton
              testID="delete-card-confirm"
              label="Eliminar"
              onPress={onConfirm}
              loading={isPending}
              disabled={inUse}
            />
            <SheetBackButton testID="delete-card-back" onPress={close} disabled={isPending} />
          </View>
        </>
      ) : null}
    </BottomSheetModal>
  );
}
