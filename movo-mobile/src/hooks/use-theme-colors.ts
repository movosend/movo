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
    // Equivalente hex de `--color-bg-mute`/`--color-border-strong` — mismo
    // motivo que el resto del archivo, algún `style` inline (no className)
    // necesita el valor resuelto en vez de la variable CSS.
    bgMute: '#F1F1F3',
    borderStrong: 'rgba(10, 10, 11, 0.18)',
    chromeGradient: ['#FFFFFF', '#EFEFF2', '#DCDCE1'] as [string, string, string],
    chromeBorderGradient: ['#FFFFFF', '#C7C7CE'] as [string, string],
    chromeShadow: 'rgba(20, 20, 25, 0.18)',
    chromeOuterGradient: ['#F3F3F6', '#E5E5EA'] as [string, string],
    chromeOuterBorderGradient: ['#FFFFFF', '#D2D2D9'] as [string, string],
    // Variante "metal" de `ActiveShipmentCard` (MOVO-193) — pill/paso futuro sí
    // necesitan más contraste que `chromeShadow`/`chromeOuterGradient`, pero la
    // sombra en sí se recalibró después (0.55 quedó "MUY fuerte" contra el
    // fondo en una ronda de feedback posterior a la US original).
    activeCardShadow: 'rgba(10, 10, 11, 0.22)',
    activeCardPillBg: 'rgba(255, 255, 255, 0.70)',
    activeCardStepFutureBg: 'rgba(255, 255, 255, 0.55)',
    activeCardFooterBorder: 'rgba(10, 10, 11, 0.14)',
  },
  dark: {
    bg: '#0A0A0B',
    fg1: '#FFFFFF',
    fg2: '#B4B4BC',
    fg3: '#8A8A93',
    bgMute: '#1A1A1D',
    borderStrong: 'rgba(255, 255, 255, 0.18)',
    chromeGradient: ['#2E2E32', '#1E1E21', '#0F0F11'] as [string, string, string],
    chromeBorderGradient: ['rgba(255, 255, 255, 0.22)', 'rgba(255, 255, 255, 0.03)'] as [string, string],
    chromeShadow: 'rgba(0, 0, 0, 0.5)',
    chromeOuterGradient: ['#19191C', '#0E0E10'] as [string, string],
    chromeOuterBorderGradient: ['rgba(255, 255, 255, 0.16)', 'rgba(255, 255, 255, 0.02)'] as [string, string],
    // Alfa mucho más baja que en claro (0.6, y después 0.35, seguían leyéndose
    // como un halo oscuro desproporcionado sobre una página que ya es oscura —
    // dos rondas de feedback del usuario, "sigue siendo MUY fuerte").
    activeCardShadow: 'rgba(0, 0, 0, 0.16)',
    activeCardPillBg: 'rgba(255, 255, 255, 0.14)',
    activeCardStepFutureBg: 'rgba(255, 255, 255, 0.08)',
    activeCardFooterBorder: 'rgba(255, 255, 255, 0.14)',
  },
} as const;

export function useThemeColors() {
  const { colorScheme } = useColorScheme();
  return THEME_COLORS[colorScheme === 'dark' ? 'dark' : 'light'];
}
