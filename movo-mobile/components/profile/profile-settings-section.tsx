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
import { useMyProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { hasPendingLegalAcceptance } from "../../src/lib/legal-acceptance";

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
 * el tercero (MOVO-224) y "Notificaciones" el cuarto (MOVO-246) — a diferencia del
 * resto, no llevan `opacity-60`.
 */
export function ProfileSettingsSection({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const { data: profile } = useMyProfile();
  const legalPending = hasPendingLegalAcceptance(profile);

  const settingsItems: SettingsItem[] = [
    { label: "Cuenta y seguridad", Icon: Shield, onPress: () => router.push("/profile/security" as any) },
    { label: "Notificaciones", Icon: Bell, onPress: () => router.push("/profile/notifications" as any) },
    { label: "Pagos y cobros", Icon: Wallet },
    { label: "Direcciones guardadas", Icon: MapPin, onPress: () => router.push("/addresses") },
    { label: "Ayuda y soporte", Icon: HelpCircle },
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
            <ChevronRight size={18} strokeWidth={1.8} color={colors.fg3} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
