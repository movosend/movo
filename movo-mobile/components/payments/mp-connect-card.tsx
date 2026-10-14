import type { MpConnectStatusResponse } from "@movo/shared/dist/types/mp-connect";
import { ArrowLeftRight, MoreHorizontal, RefreshCw } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatMpConnectedAt, shortenEmail } from "../../src/lib/mp-connect-format";
import { SkeletonBlock } from "../ui/skeleton-block";
import { MercadoPagoEmblem } from "./mercadopago-logo";
import { PaymentMethodActionRow, PaymentMethodsEmpty, PaymentMethodTile } from "./payment-method-list";

/**
 * Sección "Medios de cobro" de "Pagos y cobros" (MOVO-112), fiel al prototipo de Claude
 * Design "MOVO-112 Pagos y cobros v3": la cuenta de Mercado Pago es una fila más, igual que
 * una tarjeta guardada (recuadro, título, detalle y menú), con "Cambiar cuenta" al final y
 * desvincular dentro de sus opciones. No hace fetch ni conoce el flujo: recibe el status y
 * los callbacks.
 *
 * El prototipo no tiene el estado `invalid` (MP revocó el acceso o venció): usa la misma
 * fila con el detalle en rojo y "Volver a vincular" como acción.
 */

export function MpConnectSkeletonCard({ message, testID }: { message: string; testID?: string }) {
  const colors = useThemeColors();
  return (
    <View testID={testID} className="overflow-hidden rounded-[10px] border border-border bg-bg">
      <View className="flex-row items-center gap-3 border-b border-border px-4 py-3.5">
        <SkeletonBlock className="h-[30px] w-11 rounded-[5px]" />
        <View className="flex-1 gap-1.5">
          <SkeletonBlock className="h-3.5 w-[120px] rounded-md" />
          <SkeletonBlock className="h-3 w-[160px] rounded-md" />
        </View>
      </View>
      <View className="flex-row items-center gap-2 bg-bg-sub px-4 py-3.5">
        <ActivityIndicator size="small" color={colors.fg2} />
        <Text className="font-sans text-[13px] text-fg-2">{message}</Text>
      </View>
    </View>
  );
}

/** Email (acortado) o nickname de la cuenta vinculada. */
export function mpAccountLabel(data: MpConnectStatusResponse): string {
  if (data.account?.email) return shortenEmail(data.account.email);
  return data.account?.nickname ?? "Cuenta de Mercado Pago";
}

interface CardProps {
  data: MpConnectStatusResponse;
  /** Hay un intento de vincular en curso: las acciones quedan deshabilitadas. */
  linking: boolean;
  /** El último intento falló: el botón de "sin vincular" pasa a "Reintentar". */
  hadLinkError: boolean;
  onLink: () => void;
  /** "Cambiar cuenta" de una cuenta vinculada y vigente: pide confirmación antes de pisarla. */
  onChangeAccount: () => void;
  /** Abre las opciones de la cuenta (cambiar, volver a vincular, desvincular). */
  onOpenAccount: () => void;
}

export function MpConnectCard(props: CardProps) {
  if (props.data.status === "unlinked") return <UnlinkedEmpty {...props} />;
  return <AccountList {...props} />;
}

function UnlinkedEmpty({ linking, hadLinkError, onLink }: CardProps) {
  return (
    <PaymentMethodsEmpty
      testID="mp-connect-card-unlinked"
      actionTestID="mp-connect-link-button"
      icon={<MercadoPagoEmblem height={22} testID="mp-connect-logo" />}
      title="Todavía no vinculaste una cuenta"
      body="Vinculá Mercado Pago para llevar envíos y cobrar lo que ganás en cada entrega."
      actionLabel={hadLinkError ? "Reintentar" : "Vincular Mercado Pago"}
      onAction={onLink}
      actionDisabled={linking}
    />
  );
}

function AccountList({ data, linking, onLink, onChangeAccount, onOpenAccount }: CardProps) {
  const colors = useThemeColors();
  const invalid = data.status === "invalid";
  const label = mpAccountLabel(data);
  const connectedAt = data.account ? formatMpConnectedAt(data.account.connectedAt) : "";
  const meta = invalid
    ? "Dejó de funcionar. Volvé a vincularla para cobrar."
    : connectedAt
      ? `Vinculada el ${connectedAt}`
      : null;

  return (
    <View
      testID={invalid ? "mp-connect-card-invalid" : "mp-connect-card-linked"}
      className="overflow-hidden rounded-[10px] border border-border bg-bg"
    >
      <Pressable
        testID="mp-connect-account-row"
        accessibilityRole="button"
        accessibilityLabel={`Mercado Pago, ${label}. ${meta ?? ""}`}
        accessibilityHint="Abre las opciones de la cuenta"
        onPress={onOpenAccount}
        disabled={linking}
        className="flex-row items-center gap-3 border-b border-border px-4 py-3.5 active:bg-bg-sub"
      >
        <PaymentMethodTile>
          <MercadoPagoEmblem height={18} testID="mp-connect-linked-logo" />
        </PaymentMethodTile>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-sans-semibold text-[15px] leading-5 text-fg">Mercado Pago</Text>
          <Text
            testID={invalid ? "mp-connect-invalid-email" : "mp-connect-account-email"}
            numberOfLines={1}
            className={`font-mono text-[12px] leading-4 text-fg-2 ${invalid ? "line-through" : ""}`}
          >
            {label}
          </Text>
          {meta ? (
            <Text
              testID="mp-connect-account-meta"
              className={`font-sans text-[12px] leading-4 ${invalid ? "text-danger-600" : "text-fg-3"}`}
            >
              {meta}
            </Text>
          ) : null}
        </View>
        <MoreHorizontal size={18} color={colors.fg3} strokeWidth={2} />
      </Pressable>
      {invalid ? (
        <PaymentMethodActionRow
          testID="mp-connect-relink-button"
          icon={RefreshCw}
          label="Volver a vincular"
          onPress={onLink}
          disabled={linking}
        />
      ) : (
        <PaymentMethodActionRow
          testID="mp-connect-change-account"
          icon={ArrowLeftRight}
          label="Cambiar cuenta"
          onPress={onChangeAccount}
          disabled={linking}
        />
      )}
    </View>
  );
}
