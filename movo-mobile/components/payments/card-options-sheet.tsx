import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { Text, View } from "react-native";
import { cardLabel, cardOptionsSub, isCardExpired } from "../../src/lib/saved-cards";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { SheetBackButton, SheetOutlineButton, SheetPrimaryButton } from "./card-sheet-buttons";
import { CardBrandBox } from "./saved-cards-list";

interface CardOptionsSheetProps {
  /** Se mantiene la última tarjeta mientras la hoja anima el cierre. */
  card: SavedCard | null;
  visible: boolean;
  settingDefault: boolean;
  onMakeDefault: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
  onClosed?: () => void;
}

/**
 * Opciones de una tarjeta guardada (MOVO-101), fiel al prototipo: predeterminada, eliminar
 * y volver. "Cambiar nombre" no está en el prototipo: lo pide el AC10 del ticket y usa el
 * mismo botón con borde que "Eliminar tarjeta".
 */
export function CardOptionsSheet({
  card,
  visible,
  settingDefault,
  onMakeDefault,
  onRename,
  onDelete,
  onClose,
  onClosed,
}: CardOptionsSheetProps) {
  const expired = card ? isCardExpired(card) : false;
  const close = () => {
    if (!settingDefault) onClose();
  };

  return (
    <BottomSheetModal
      visible={visible && !!card}
      onRequestClose={close}
      testID="card-options-sheet"
      backdropTestID="card-options-sheet-backdrop"
      sheetClassName="rounded-t-2xl bg-bg px-5 pt-5"
      contentClassName="gap-4 pb-2"
      onClosed={onClosed}
    >
      {card ? (
        <>
          <View className="flex-row items-center gap-3">
            <CardBrandBox brand={card.brand} size="lg" />
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="font-sans-semibold text-[17px] leading-[22px] text-fg">
                {cardLabel(card)}
              </Text>
              <Text className={`mt-0.5 font-sans text-[13px] ${expired ? "text-danger-600" : "text-fg-3"}`}>
                {cardOptionsSub(card)}
              </Text>
            </View>
          </View>
          {card.isDefault ? (
            <View testID="card-options-default-note" className="rounded-[10px] bg-bg-mute px-3.5 py-3">
              <Text className="font-sans text-[12.5px] leading-[18px] text-fg-2">
                Es tu tarjeta predeterminada. Te la proponemos primero cada vez que pagás.
              </Text>
            </View>
          ) : null}
          {expired ? (
            <View
              testID="card-options-expired-note"
              className="rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
            >
              <Text className="font-sans text-[12.5px] leading-[18px] text-ink-950">
                Esta tarjeta venció y ya no se puede usar. Si tu banco te dio una nueva, agregala con los datos nuevos.
              </Text>
            </View>
          ) : null}
          <View className="gap-2.5">
            {!card.isDefault && !expired ? (
              <SheetPrimaryButton
                testID="card-options-make-default"
                label="Usar como predeterminada"
                onPress={onMakeDefault}
                loading={settingDefault}
              />
            ) : null}
            <SheetOutlineButton
              testID="card-options-rename"
              label={card.alias ? "Cambiar nombre" : "Ponerle un nombre"}
              onPress={onRename}
              disabled={settingDefault}
            />
            <SheetOutlineButton
              testID="card-options-delete"
              label="Eliminar tarjeta"
              tone="danger"
              onPress={onDelete}
              disabled={settingDefault}
            />
            <SheetBackButton testID="card-options-back" onPress={close} disabled={settingDefault} />
          </View>
        </>
      ) : null}
    </BottomSheetModal>
  );
}
