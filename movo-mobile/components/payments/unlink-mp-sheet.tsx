import { ConfirmActionSheet } from "../ui/confirm-action-sheet";

export interface UnlinkMpSheetProps {
  visible: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmación de "Desvincular" (MOVO-112 AC5): un sheet propio y no un `Alert`, sobre
 * `ConfirmActionSheet`. Mientras se desvincula no se puede cerrar.
 */
export function UnlinkMpSheet({ visible, isPending, onConfirm, onClose }: UnlinkMpSheetProps) {
  return (
    <ConfirmActionSheet
      visible={visible}
      title="¿Desvincular Mercado Pago?"
      description="Si desvinculás tu cuenta, no vas a poder cobrar tus envíos hasta volver a vincularla. ¿Continuar?"
      confirmLabel="Desvincular"
      tone="danger"
      isPending={isPending}
      onConfirm={onConfirm}
      onClose={onClose}
      testID="unlink-mp-sheet"
    />
  );
}
