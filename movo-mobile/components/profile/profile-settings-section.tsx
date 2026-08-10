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
}

const SETTINGS_ITEMS: SettingsItem[] = [
  { label: "Cuenta y seguridad", Icon: Shield },
  { label: "Notificaciones", Icon: Bell },
  { label: "Pagos y cobros", Icon: Wallet },
  { label: "Direcciones guardadas", Icon: MapPin },
  { label: "Ayuda y soporte", Icon: HelpCircle },
  { label: "Legal", Icon: FileText },
];

/**
 * Sección "CONFIGURACIÓN" del perfil (MOVO-78) — fiel a la referencia visual, pero
 * ninguna de las 6 pantallas existe todavía. Cada ítem queda deshabilitado
 * visualmente y da un feedback simple al tocarlo. Se usa `Alert.alert` nativo (sin
 * traer una librería de toast nueva solo para este caso, no hay ninguna instalada hoy)
 * — si en el futuro se agrega una para otro flujo, vale la pena migrar esto también.
 */
export function ProfileSettingsSection({ testID }: { testID?: string }) {
  const colors = useThemeColors();

  return (
    <View testID={testID} className="mb-5">
      <Text className="mb-2.5 font-sans-semibold text-caption uppercase text-fg-3">
        Configuración
      </Text>
      <View className="overflow-hidden rounded-[10px] border border-border bg-bg-sub">
        {SETTINGS_ITEMS.map(({ label, Icon }, index) => (
          <Pressable
            key={label}
            onPress={() => Alert.alert("Próximamente", "Estamos trabajando en esta sección.")}
            className={`flex-row items-center gap-3 px-4 py-4 opacity-60 ${
              index < SETTINGS_ITEMS.length - 1 ? "border-b border-border" : ""
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
