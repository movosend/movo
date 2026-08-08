import { useColorScheme } from 'nativewind';

/**
 * Equivalentes hex de los tokens `fg`/`fg-2`/`fg-3` de `global.css`, para los
 * pocos lugares donde se necesita un color en JS en vez de una className
 * (props `color` de iconos SVG, `placeholderTextColor`, `ActivityIndicator`)
 * — NativeWind no puede resolver variables CSS ahí. Mantener en sync con los
 * valores de `:root` / `.dark:root` en `global.css`.
 */
const THEME_COLORS = {
  light: { bg: '#FFFFFF', fg1: '#0A0A0B', fg2: '#3A3A40', fg3: '#5A5A62' },
  dark: { bg: '#0A0A0B', fg1: '#FFFFFF', fg2: '#B4B4BC', fg3: '#8A8A93' },
} as const;

export function useThemeColors() {
  const { colorScheme } = useColorScheme();
  return THEME_COLORS[colorScheme === 'dark' ? 'dark' : 'light'];
}
