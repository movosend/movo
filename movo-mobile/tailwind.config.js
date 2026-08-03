/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // "class" (no "media"): es el único modo en el que NativeWind reconoce el
  // patrón `.dark:root { ... }` de global.css como bloque de variables CSS
  // dark. NativeWind sigue igual el `Appearance` del sistema automáticamente
  // por default — "class" no implica toggle manual, solo habilita que las
  // variables CSS con esa sintaxis funcionen. Ver CLAUDE.md, MOVO-73 (extra).
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter_400Regular'],
        'sans-medium': ['Inter_500Medium'],
        'sans-semibold': ['Inter_600SemiBold'],
        mono: ['JetBrainsMono_400Regular'],
        'mono-medium': ['JetBrainsMono_500Medium'],
        'mono-semibold': ['JetBrainsMono_600SemiBold'],
      },
      // ── Jerarquía tipográfica mobile ──
      // Escala pensada para pantalla de teléfono (no los tamaños del manual
      // de marca, que son para slides de 1920px). Pasos moderados a
      // propósito: separación de jerarquía perceptible pero sin gritar —
      // nada "hero" salvo `display`, que se usa con criterio (1 por pantalla).
      fontSize: {
        display: ['34px', { lineHeight: '40px', letterSpacing: '-0.4px' }],
        title: ['24px', { lineHeight: '30px', letterSpacing: '-0.3px' }],
        h2: ['20px', { lineHeight: '26px', letterSpacing: '-0.2px' }],
        h3: ['17px', { lineHeight: '22px', letterSpacing: '-0.1px' }],
        body: ['15px', { lineHeight: '22px', letterSpacing: '0px' }],
        small: ['13px', { lineHeight: '18px', letterSpacing: '0px' }],
        caption: ['11px', { lineHeight: '14px', letterSpacing: '0.6px' }],
        mono: ['13px', { lineHeight: '18px', letterSpacing: '0px' }],
      },
      colors: {
        // ── Neutros (escala ink + paper) ──
        paper: '#FFFFFF',
        ink: {
          50: '#F8F8FA',
          100: '#F1F1F3',
          150: '#E6E6EA',
          200: '#D5D5DB',
          300: '#B4B4BC',
          400: '#8A8A93',
          500: '#5A5A62',
          600: '#3A3A40',
          700: '#27272B',
          800: '#1A1A1D',
          900: '#111113',
          950: '#0A0A0B',
        },

        // ── Acentos vivos (no se tocan) ──
        lime: {
          200: '#EEFCBF',
          400: '#D6F771',
          500: '#C6F24A',
          600: '#9FC72E',
        },
        route: {
          500: '#2B6BFF',
        },

        // ── Semánticos, 7 pasos c/u ──
        success: {
          100: '#E3F8ED',
          200: '#C3F0DA',
          300: '#93E4BE',
          400: '#5CD39D',
          500: '#2BB673',
          600: '#1F9760',
          700: '#16754A',
        },
        warning: {
          100: '#FEF7E7',
          200: '#FCEAC0',
          300: '#F9D888',
          400: '#F7C860',
          500: '#F5B93A',
          600: '#D69A1E',
          700: '#A97714',
        },
        danger: {
          100: '#FCE7E7',
          200: '#F9C9CB',
          300: '#F3999D',
          400: '#EC6A70',
          500: '#E5484D',
          600: '#C22F35',
          700: '#972327',
        },
        info: {
          100: '#EDF3FF',
          200: '#CBDAFF',
          300: '#A8C2FF',
          400: '#5A8CFF',
          500: '#2B6BFF',
          600: '#1F52D6',
          700: '#173EA3',
        },

        // ── Tokens semánticos de superficie/texto (light por defecto, dark vía .dark:root) ──
        bg: 'var(--color-bg)',
        'bg-sub': 'var(--color-bg-sub)',
        'bg-mute': 'var(--color-bg-mute)',
        fg: {
          DEFAULT: 'var(--color-fg-1)',
          2: 'var(--color-fg-2)',
          3: 'var(--color-fg-3)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
      },
    },
  },
  plugins: [],
};
