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
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface SettingsItem {
  label: string;
  Icon: LucideIcon;
  /** `undefined` = placeholder, sigue mostrando el `Alert.alert` de "Próximamente". */
  onPress?: () => void;
}

/**
 * Sección "CONFIGURACIÓN" del perfil (MOVO-78) — fiel a la referencia visual. 5 de
 * los 6 ítems siguen sin pantalla propia y quedan deshabilitados visualmente con el
 * mismo `Alert.alert("Próximamente", ...)` de siempre (sin traer una librería de
 * toast nueva solo para este caso). "Direcciones guardadas" es el primero en tener
 * pantalla real (MOVO-121) — a diferencia del resto, no lleva `opacity-60`.
 */
export function ProfileSettingsSection({ testID }: { testID?: string }) {
  const colors = useThemeColors();

  const settingsItems: SettingsItem[] = [
    { label: "Cuenta y seguridad", Icon: Shield },
    { label: "Notificaciones", Icon: Bell },
    { label: "Pagos y cobros", Icon: Wallet },
    { label: "Direcciones guardadas", Icon: MapPin, onPress: () => router.push("/addresses") },
    { label: "Ayuda y soporte", Icon: HelpCircle },
    { label: "Legal", Icon: FileText },
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
            <Text className="flex-1 font-sans text-[15px] text-fg">{label}</Text>
            <ChevronRight size={18} strokeWidth={1.8} color={colors.fg3} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
