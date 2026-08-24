import { Home, Settings, Truck, type LucideIcon } from "lucide-react-native";

/**
 * Config estática de los 3 tabs (MOVO-78). Única fuente de nombre técnico↔label↔ícono
 * — tanto `app/(app)/(tabs)/_layout.tsx` (declara las `Tabs.Screen`) como
 * `floating-tab-bar.tsx` (renderiza los botones) la consumen, para no duplicar strings.
 *
 * `name` tiene que matchear el nombre de archivo de la screen dentro de
 * `app/(app)/(tabs)/` (sin extensión) — es lo que expo-router usa como `route.name`.
 */
export interface TabBarItemConfig {
  name: "home" | "transport" | "profile";
  label: string;
  Icon: LucideIcon;
}

export const TAB_BAR_ITEMS: TabBarItemConfig[] = [
  { name: "home", label: "Inicio", Icon: Home },
  { name: "transport", label: "Transportar", Icon: Truck },
  { name: "profile", label: "Mi perfil", Icon: Settings },
];
