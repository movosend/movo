import type { MpConnectStatusResponse } from "@movo/shared/dist/types/mp-connect";
import { Text, View } from "react-native";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { SheetBackButton, SheetOutlineButton, SheetPrimaryButton } from "./card-sheet-buttons";
import { MercadoPagoEmblem } from "./mercadopago-logo";
import { mpAccountLabel } from "./mp-connect-card";
import { PaymentMethodTile } from "./payment-method-list";

interface MpAccountSheetProps {
  /** Se mantiene el último status mientras la hoja anima el cierre. */
  data: MpConnectStatusResponse | null;
  visible: boolean;
  onLink: () => void;
  onUnlink: () => void;
  onClose: () => void;
  onClosed?: () => void;
}

/**
 * Opciones de la cuenta de cobro (prototipo "MOVO-112 Pagos y cobros v3"), con el mismo
 * armado que las opciones de una tarjeta: cambiar la cuenta, desvincular y volver. Con la
 * vinculación `invalid` (no está en el prototipo) la nota explica qué pasó y la acción
 * principal es "Volver a vincular".
 */
export function MpAccountSheet({ data, visible, onLink, onUnlink, onClose, onClosed }: MpAccountSheetProps) {
  const invalid = data?.status === "invalid";
  return (
    <BottomSheetModal
      visible={visible && !!data}
      onRequestClose={onClose}
      testID="mp-account-sheet"
      backdropTestID="mp-account-sheet-backdrop"
      sheetClassName="rounded-t-2xl bg-bg px-5 pt-5"
      contentClassName="gap-4 pb-2"
      onClosed={onClosed}
    >
      {data ? (
        <>
          <View className="flex-row items-center gap-3">
            <PaymentMethodTile size="lg">
              <MercadoPagoEmblem height={20} />
            </PaymentMethodTile>
            <View className="min-w-0 flex-1">
              <Text className="font-sans-semibold text-[17px] leading-[22px] text-fg">Mercado Pago</Text>
              <Text numberOfLines={1} className="mt-0.5 font-mono text-[12px] text-fg-3">
                {mpAccountLabel(data)}
              </Text>
            </View>
          </View>
          {invalid ? (
            <View
              testID="mp-account-sheet-invalid-note"
              className="rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
            >
              <Text className="font-sans text-[12.5px] leading-[18px] text-ink-950">
                Tu vinculación dejó de funcionar: se venció o revocaste el acceso desde Mercado Pago. Hasta que la
                vuelvas a vincular, no podés cobrar tus envíos.
              </Text>
            </View>
          ) : (
            <View testID="mp-account-sheet-note" className="rounded-[10px] bg-bg-mute px-3.5 py-3">
              <Text className="font-sans text-[12.5px] leading-[18px] text-fg-2">
                Cada entrega que hacés se acredita en esta cuenta. No se usa para pagar.
              </Text>
            </View>
          )}
          <View className="gap-2.5">
            <SheetPrimaryButton
              testID="mp-account-sheet-link"
              label={invalid ? "Volver a vincular" : "Cambiar cuenta"}
              onPress={onLink}
            />
            <SheetOutlineButton testID="mp-account-sheet-unlink" label="Desvincular" tone="danger" onPress={onUnlink} />
            <SheetBackButton testID="mp-account-sheet-back" onPress={onClose} />
          </View>
        </>
      ) : null}
    </BottomSheetModal>
  );
}
