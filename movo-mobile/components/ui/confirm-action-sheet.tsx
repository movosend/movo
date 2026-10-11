import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { BottomSheetModal } from "./bottom-sheet-modal";

export interface ConfirmActionSheetProps {
  visible: boolean;
  title: string;
  /** Texto bajo el título; también acepta nodos para resaltar partes en negrita. */
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `lime` para confirmar una acción; `danger` para una destructiva. */
  tone?: "lime" | "danger";
  isPending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Ver `BottomSheetModal#onClosed`. */
  onClosed?: () => void;
  /** Contenido extra entre la descripción y los botones (ej. un aviso o un `ErrorBanner`). */
  children?: ReactNode;
  testID: string;
}

/**
 * Hoja de confirmación estándar (mismo armado que `ChooseOfferModal`/`UnlinkMpSheet`): título,
 * descripción, botón principal de 48px a todo el ancho y "Volver" como texto. Mientras la acción
 * está en curso no se puede cerrar. Los `testID` derivan del prefijo: `-backdrop`, `-confirm`
 * y `-cancel`.
 */
export function ConfirmActionSheet({
  visible,
  title,
  description,
  confirmLabel,
  cancelLabel = "Volver",
  tone = "lime",
  isPending = false,
  onConfirm,
  onClose,
  onClosed,
  children,
  testID,
}: ConfirmActionSheetProps) {
  const close = () => {
    if (!isPending) onClose();
  };
  const lime = tone === "lime";

  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={close}
      testID={testID}
      backdropTestID={`${testID}-backdrop`}
      backdropClassName="bg-black/50"
      sheetClassName="rounded-t-[24px] border-t border-border bg-bg px-5 pt-5"
      contentClassName="gap-4"
      onClosed={onClosed}
    >
      <Text className="font-sans-semibold text-h3 text-fg">{title}</Text>
      {description ? <Text className="font-sans text-small leading-5 text-fg-2">{description}</Text> : null}
      {children}
      <View className="gap-2.5 pb-2 pt-2">
        <Pressable
          testID={`${testID}-confirm`}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          accessibilityState={{ disabled: isPending, busy: isPending }}
          onPress={onConfirm}
          disabled={isPending}
          className={`h-12 items-center justify-center rounded-[12px] ${
            lime ? "bg-lime-500 active:bg-lime-400" : "bg-danger-500 active:opacity-80"
          }`}
        >
          {isPending ? (
            <ActivityIndicator color={lime ? "#0A0A0B" : "#FFFFFF"} size="small" />
          ) : (
            <Text className={`font-sans-semibold text-small ${lime ? "text-ink-950" : "text-white"}`}>
              {confirmLabel}
            </Text>
          )}
        </Pressable>
        <Pressable
          testID={`${testID}-cancel`}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          accessibilityState={{ disabled: isPending }}
          onPress={close}
          disabled={isPending}
          className="h-11 items-center justify-center rounded-[12px]"
        >
          <Text className="font-sans-medium text-small text-fg-2">{cancelLabel}</Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}
