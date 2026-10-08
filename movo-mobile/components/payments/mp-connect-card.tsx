import type { MpConnectStatusResponse } from "@movo/shared/dist/types/mp-connect";
import { AlertTriangle } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatMpConnectedAt } from "../../src/lib/mp-connect-format";
import { SkeletonBlock } from "../ui/skeleton-block";
import { MercadoPagoLogo } from "./mercadopago-logo";
import { MpStatusPill } from "./mp-status-pill";

/**
 * Tarjeta de "Pagos y cobros" (MOVO-112), fiel al mockup de Claude Design. Una variante
 * por estado de la vinculación más el skeleton de carga. No hace fetch ni conoce el
 * flujo: recibe el status y los callbacks.
 */

export function MpConnectSkeletonCard({ message, testID }: { message: string; testID?: string }) {
  const colors = useThemeColors();
  return (
    <View testID={testID} className="gap-3.5 rounded-2xl border border-border bg-bg-sub p-4">
      <View className="flex-row items-center gap-3">
        <SkeletonBlock className="h-10 w-10 rounded-[10px]" />
        <View className="flex-1 gap-1.5">
          <SkeletonBlock className="h-3.5 w-[140px] rounded-md" />
          <SkeletonBlock className="h-3 w-24 rounded-md" />
        </View>
      </View>
      <View className="flex-row items-center gap-2">
        <ActivityIndicator size="small" color={colors.fg2} />
        <Text className="font-sans text-[13px] text-fg-2">{message}</Text>
      </View>
    </View>
  );
}

function CtaButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      className={`items-center rounded-full py-3 ${disabled ? "bg-bg-mute" : "bg-fg active:opacity-80"}`}
    >
      <Text className={`font-sans-semibold text-[14px] ${disabled ? "text-fg-3" : "text-bg"}`}>{label}</Text>
    </Pressable>
  );
}

function AccountAvatar({ initials, muted }: { initials: string; muted?: boolean }) {
  return (
    <View
      className={`h-9 w-9 items-center justify-center rounded-full ${muted ? "bg-ink-500" : "bg-ink-950"}`}
    >
      <Text className="font-sans-semibold text-[13px] text-white">{initials}</Text>
    </View>
  );
}

interface CardProps {
  data: MpConnectStatusResponse;
  /** Iniciales del usuario de Movo, para el avatar de la cuenta vinculada. */
  initials: string;
  isDark: boolean;
  /** Hay un intento de vincular en curso: el CTA queda deshabilitado (evita doble apertura). */
  linking: boolean;
  /** El último intento falló: el CTA de "sin vincular" pasa a "Reintentar". */
  hadLinkError: boolean;
  onLink: () => void;
  onUnlink: () => void;
}

export function MpConnectCard(props: CardProps) {
  if (props.data.status === "linked") return <LinkedCard {...props} />;
  if (props.data.status === "invalid") return <InvalidCard {...props} />;
  return <UnlinkedCard {...props} />;
}

function UnlinkedCard({ isDark, linking, hadLinkError, onLink }: CardProps) {
  return (
    <View testID="mp-connect-card-unlinked" className="gap-3.5 rounded-2xl border border-border bg-bg-sub p-4">
      <View className="flex-row items-center justify-between">
        <View className="-my-1.5 -ml-2">
          <MercadoPagoLogo height={40} inverted={isDark} testID="mp-connect-logo" />
        </View>
        <MpStatusPill status="unlinked" variant="card" />
      </View>
      <Text className="font-sans text-[13.5px] leading-[19px] text-fg-2">
        Vinculá tu cuenta para cobrar tus envíos. Ahí te acreditamos lo que ganás en cada viaje.
      </Text>
      <View
        testID="mp-connect-unlinked-warning"
        className="flex-row items-start gap-2 rounded-[10px] border border-warning-300 bg-warning-100 px-3 py-2.5"
      >
        <AlertTriangle size={15} strokeWidth={2.2} color="#A97714" style={{ marginTop: 1 }} />
        <Text className="flex-1 font-sans text-[12.5px] leading-[17px] text-ink-950">
          No vas a poder cobrar hasta vincular tu cuenta.
        </Text>
      </View>
      <CtaButton
        testID="mp-connect-link-button"
        label={hadLinkError ? "Reintentar" : "Vincular cuenta de Mercado Pago"}
        onPress={onLink}
        disabled={linking}
      />
    </View>
  );
}

function LinkedCard({ data, initials, onUnlink, linking }: CardProps) {
  const account = data.account;
  const connectedAt = account ? formatMpConnectedAt(account.connectedAt) : "";
  return (
    <>
      <View testID="mp-connect-card-linked" className="gap-3.5 rounded-2xl border border-border bg-bg-sub p-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-semibold text-[17px] text-fg">Mercado Pago</Text>
          <MpStatusPill status="linked" variant="card" testID="mp-connect-linked-pill" />
        </View>
        <View className="flex-row items-center gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
          <AccountAvatar initials={initials} />
          <View className="min-w-0 flex-1">
            <Text testID="mp-connect-account-email" numberOfLines={1} className="font-sans-semibold text-[14px] text-fg">
              {account?.email ?? account?.nickname ?? "Cuenta de Mercado Pago"}
            </Text>
            <Text className="mt-0.5 font-sans text-[11.5px] text-fg-3">
              {connectedAt ? `Vinculada el ${connectedAt} · ahí cobrás tus envíos` : "Ahí cobrás tus envíos"}
            </Text>
          </View>
        </View>
        <Text className="font-sans text-[12.5px] leading-[18px] text-fg-2">
          Todo listo para cobrar. Cada entrega se acredita en esta cuenta.
        </Text>
      </View>
      <Pressable
        testID="mp-connect-unlink-button"
        onPress={onUnlink}
        disabled={linking}
        className="items-center rounded-lg border border-border-strong bg-bg py-[13px] active:opacity-80"
      >
        <Text className="font-sans-semibold text-[15px] text-danger-600">Desvincular</Text>
      </Pressable>
    </>
  );
}

function InvalidCard({ data, initials, linking, onLink }: CardProps) {
  const account = data.account;
  return (
    <View testID="mp-connect-card-invalid" className="gap-3.5 rounded-2xl border border-danger-300 bg-danger-100 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-[17px] text-ink-950">Mercado Pago</Text>
        <MpStatusPill status="invalid" variant="card" />
      </View>
      <View>
        <Text className="font-sans-semibold text-[13.5px] text-ink-950">Tu vinculación dejó de funcionar</Text>
        <Text className="mt-[3px] font-sans text-[13px] leading-[19px] text-ink-950">
          Se venció o revocaste el acceso desde Mercado Pago. Hasta que la vuelvas a vincular, no podés cobrar tus envíos.
        </Text>
      </View>
      {account ? (
        <View className="flex-row items-center gap-3 rounded-xl bg-white/60 px-3.5 py-3 opacity-70">
          <AccountAvatar initials={initials} muted />
          <Text
            testID="mp-connect-invalid-email"
            numberOfLines={1}
            className="flex-1 font-sans-medium text-[14px] text-ink-950 line-through"
          >
            {account.email ?? account.nickname ?? "Cuenta de Mercado Pago"}
          </Text>
        </View>
      ) : null}
      <CtaButton testID="mp-connect-relink-button" label="Volver a vincular" onPress={onLink} disabled={linking} />
    </View>
  );
}
