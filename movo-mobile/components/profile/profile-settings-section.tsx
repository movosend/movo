import { router } from "expo-router";
import {
  Bell,
  ChevronRight,
  FileText,
  HelpCircle,
  MapPin,
  Shield,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { Alert, Pressable, Text, View } from "react-native";
import { useBalance } from "../../src/hooks/use-balance";
import { useMpConnectStatus } from "../../src/hooks/use-mp-connect";
import { useMyProfile } from "../../src/hooks/use-profile";
import { useSavedCards } from "../../src/hooks/use-saved-cards";
import { useSupportList } from "../../src/hooks/use-support";
import { PaymentsAttentionPill } from "../payments/payments-attention-pill";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatUnreadCount } from "../../src/lib/chat-format";
import { supportTotalUnread } from "../../src/lib/support-format";
import { hasPendingLegalAcceptance } from "../../src/lib/legal-acceptance";
import { paymentsAttention } from "../../src/lib/payments-attention";

interface SettingsItem {
  label: string;
  Icon: LucideIcon;
  /** `undefined` = placeholder, sigue mostrando el `Alert.alert` de "Próximamente". */
  onPress?: () => void;
}

/**
 * Sección "CONFIGURACIÓN" del perfil (MOVO-78) — fiel a la referencia visual. Los
 * ítems que todavía no tienen pantalla propia quedan deshabilitados visualmente con
 * el mismo `Alert.alert("Próximamente", ...)` de siempre (sin traer una librería de
 * toast nueva solo para este caso). "Direcciones guardadas" fue el primero en tener
 * pantalla real (MOVO-121), "Cuenta y seguridad" el segundo (MOVO-136), "Legal"
 * el tercero (MOVO-224), "Notificaciones" el cuarto (MOVO-246) y "Pagos y cobros" el
 * quinto (MOVO-112, con un aviso en la fila si hay algo que resolver) — a diferencia del resto,
 * no llevan `opacity-60`. "Ayuda y soporte" abre el submenú de ayuda (MOVO-324): escribirle a Movo y repasar el
 * tutorial (MOVO-169); la fila lleva el total de consultas sin leer.
 */
export function ProfileSettingsSection({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const { data: profile } = useMyProfile();
  const legalPending = hasPendingLegalAcceptance(profile);
  const supportUnread = supportTotalUnread(useSupportList().data);
  // MOVO-112/101/315: aviso en la fila solo si Mercado Pago dejó de funcionar, hay saldo
  // pendiente con Movo o todas las tarjetas vencieron. Sin aviso mientras carga o si falla.
  const balanceArs = useBalance().data?.pages[0]?.balanceArs;
  const attention = paymentsAttention(useMpConnectStatus().data?.status, useSavedCards().data, balanceArs);
  // La pantalla abre en Saldo; un problema de Mercado Pago o de tarjetas se resuelve en la otra pestaña.
  const paymentsRoute = attention === "mp_invalid" || attention === "cards_expired" ? "/profile/payments?tab=methods" : "/profile/payments";

  const settingsItems: SettingsItem[] = [
    { label: "Cuenta y seguridad", Icon: Shield, onPress: () => router.push("/profile/security" as any) },
    { label: "Notificaciones", Icon: Bell, onPress: () => router.push("/profile/notifications" as any) },
    { label: "Pagos y cobros", Icon: Wallet, onPress: () => router.push(paymentsRoute as any) },
    { label: "Direcciones guardadas", Icon: MapPin, onPress: () => router.push("/addresses") },
    { label: "Ayuda y soporte", Icon: HelpCircle, onPress: () => router.push("/support" as any) },
    { label: "Legal", Icon: FileText, onPress: () => router.push("/profile/legal" as any) },
  ];

  return (
    <View testID={testID} className="mb-5">
      <Text className="mb-2.5 font-sans-semibold text-caption uppercase text-fg-3">
        Configuración
      </Text>
      <View className="overflow-hidden rounded-[10px] border border-border bg-bg-sub">
        {settingsItems.map(({ label, Icon, onPress }, index) => (
          <Pressable
            key={label}
            testID={testID ? `${testID}-${label}` : undefined}
            onPress={
              onPress ??
              (() => Alert.alert("Próximamente", "Estamos trabajando en esta sección."))
            }
            className={`flex-row items-center gap-3 px-4 py-4 ${onPress ? "" : "opacity-60"} ${
              index < settingsItems.length - 1 ? "border-b border-border" : ""
            }`}
          >
            <Icon size={18} strokeWidth={1.8} color={colors.fg3} />
            <View className="flex-1 flex-row items-center gap-1.5">
              <Text className="font-sans text-[15px] text-fg">{label}</Text>
              {label === "Legal" && legalPending ? (
                <View testID="profile-settings-legal-pending-dot" className="h-[7px] w-[7px] rounded-full bg-warning-500" />
              ) : null}
            </View>
            {label === "Ayuda y soporte" && supportUnread > 0 ? (
              <View
                testID="profile-settings-support-unread"
                className="items-center justify-center"
                style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#C6F24A", paddingHorizontal: 6 }}
              >
                <Text className="font-sans-semibold" style={{ fontSize: 11, color: "#0A0A0B" }}>
                  {formatUnreadCount(supportUnread)}
                </Text>
              </View>
            ) : null}
            {label === "Pagos y cobros" && attention ? (
              <PaymentsAttentionPill attention={attention} balanceArs={balanceArs} testID="profile-settings-payments-pill" />
            ) : null}
            <ChevronRight size={18} strokeWidth={1.8} color={colors.fg3} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
