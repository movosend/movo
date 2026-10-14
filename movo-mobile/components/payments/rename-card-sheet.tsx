import { SAVED_CARD_ALIAS_MAX_LENGTH, type SavedCard } from "@movo/shared/dist/types/saved-card";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { cardTitle } from "../../src/lib/saved-cards";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { CardField } from "./card-field";
import { SheetBackButton, SheetOutlineButton, SheetPrimaryButton } from "./card-sheet-buttons";

interface RenameCardSheetProps {
  card: SavedCard | null;
  visible: boolean;
  isPending: boolean;
  /** Motivo del rechazo del backend (`400 VALIDATION_FAILED`), debajo del campo. */
  error: string | null;
  onSave: (alias: string | null) => void;
  onClose: () => void;
  onClosed?: () => void;
}

/**
 * Renombrar o quitar el nombre de referencia de una tarjeta (MOVO-101 AC10). No está en el
 * prototipo: arma la hoja con sus mismas piezas (campo del paso 3 con contador, botones de
 * la hoja de opciones).
 */
export function RenameCardSheet({ card, visible, isPending, error, onSave, onClose, onClosed }: RenameCardSheetProps) {
  const [value, setValue] = useState(card?.alias ?? "");

  useEffect(() => {
    if (visible) setValue(card?.alias ?? "");
  }, [visible, card?.id, card?.alias]);

  const trimmed = value.trim();
  const unchanged = trimmed === (card?.alias ?? "");
  const close = () => {
    if (!isPending) onClose();
  };

  return (
    <BottomSheetModal
      visible={visible && !!card}
      onRequestClose={close}
      testID="rename-card-sheet"
      backdropTestID="rename-card-sheet-backdrop"
      sheetClassName="rounded-t-2xl bg-bg px-5 pt-5"
      contentClassName="gap-4 pb-2"
      onClosed={onClosed}
      avoidKeyboard
    >
      {card ? (
        <>
          <View>
            <Text className="font-sans-semibold text-[17px] leading-[22px] text-fg">Nombre de la tarjeta</Text>
            <Text className="mt-0.5 font-mono text-[12px] text-fg-3">{cardTitle(card)}</Text>
          </View>
          <View className="gap-1.5">
            <CardField
              testID="rename-card-input"
              label="Nombre de la tarjeta"
              labelHint="(opcional)"
              labelRight={`${value.length}/${SAVED_CARD_ALIAS_MAX_LENGTH}`}
              value={value}
              onChangeText={(text) => setValue(text.slice(0, SAVED_CARD_ALIAS_MAX_LENGTH))}
              maxLength={SAVED_CARD_ALIAS_MAX_LENGTH}
              placeholder="Ej: Personal, Cuenta sueldo"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => !unchanged && onSave(trimmed || null)}
              error={error}
            />
            <Text className="font-sans text-[12px] leading-4 text-fg-3">
              Un nombre tuyo para reconocerla rápido. No escribas el número de la tarjeta.
            </Text>
          </View>
          <View className="gap-2.5">
            <SheetPrimaryButton
              testID="rename-card-save"
              label="Guardar"
              onPress={() => onSave(trimmed || null)}
              disabled={unchanged}
              loading={isPending}
            />
            {card.alias ? (
              <SheetOutlineButton
                testID="rename-card-remove"
                label="Quitar nombre"
                onPress={() => onSave(null)}
                disabled={isPending}
              />
            ) : null}
            <SheetBackButton testID="rename-card-back" onPress={close} disabled={isPending} />
          </View>
        </>
      ) : null}
    </BottomSheetModal>
  );
}
