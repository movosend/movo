import { useColorScheme } from 'nativewind';

/**
 * Equivalentes hex de los tokens `fg`/`fg-2`/`fg-3` de `global.css`, para los
 * pocos lugares donde se necesita un color en JS en vez de una className
 * (props `color` de iconos SVG, `placeholderTextColor`, `ActivityIndicator`)
 * — NativeWind no puede resolver variables CSS ahí. Mantener en sync con los
 * valores de `:root` / `.dark:root` en `global.css`.
 */
const THEME_COLORS = {
  light: {
    bg: '#FFFFFF',
    fg1: '#0A0A0B',
    fg2: '#3A3A40',
    fg3: '#5A5A62',
    chromeGradient: ['#FFFFFF', '#EFEFF2', '#DCDCE1'] as [string, string, string],
    chromeBorderGradient: ['#FFFFFF', '#C7C7CE'] as [string, string],
    chromeShadow: 'rgba(20, 20, 25, 0.18)',
    chromeOuterGradient: ['#F3F3F6', '#E5E5EA'] as [string, string],
    chromeOuterBorderGradient: ['#FFFFFF', '#D2D2D9'] as [string, string],
  },
  dark: {
    bg: '#0A0A0B',
    fg1: '#FFFFFF',
    fg2: '#B4B4BC',
    fg3: '#8A8A93',
    chromeGradient: ['#2E2E32', '#1E1E21', '#0F0F11'] as [string, string, string],
    chromeBorderGradient: ['rgba(255, 255, 255, 0.22)', 'rgba(255, 255, 255, 0.03)'] as [string, string],
    chromeShadow: 'rgba(0, 0, 0, 0.5)',
    chromeOuterGradient: ['#19191C', '#0E0E10'] as [string, string],
    chromeOuterBorderGradient: ['rgba(255, 255, 255, 0.16)', 'rgba(255, 255, 255, 0.02)'] as [string, string],
  },
} as const;

export function useThemeColors() {
  const { colorScheme } = useColorScheme();
  return THEME_COLORS[colorScheme === 'dark' ? 'dark' : 'light'];
}
