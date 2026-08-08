import { Link } from 'expo-router';
import { colorScheme, useColorScheme } from 'nativewind';
import { ScrollView, Text, View } from 'react-native';

type Swatch = {
  label: string;
  hex: string;
  swatchClassName: string;
  textClassName: string;
};

const NEUTRALS: Swatch[] = [
  { label: 'paper', hex: '#FFFFFF', swatchClassName: 'bg-paper border border-ink-150', textClassName: 'text-ink-950' },
  { label: 'ink-50', hex: '#F8F8FA', swatchClassName: 'bg-ink-50 border border-ink-150', textClassName: 'text-ink-950' },
  { label: 'ink-100', hex: '#F1F1F3', swatchClassName: 'bg-ink-100 border border-ink-150', textClassName: 'text-ink-950' },
  { label: 'ink-150', hex: '#E6E6EA', swatchClassName: 'bg-ink-150', textClassName: 'text-ink-950' },
  { label: 'ink-200', hex: '#D5D5DB', swatchClassName: 'bg-ink-200', textClassName: 'text-ink-950' },
  { label: 'ink-300', hex: '#B4B4BC', swatchClassName: 'bg-ink-300', textClassName: 'text-ink-950' },
  { label: 'ink-400', hex: '#8A8A93', swatchClassName: 'bg-ink-400', textClassName: 'text-paper' },
  { label: 'ink-500', hex: '#5A5A62', swatchClassName: 'bg-ink-500', textClassName: 'text-paper' },
  { label: 'ink-600', hex: '#3A3A40', swatchClassName: 'bg-ink-600', textClassName: 'text-paper' },
  { label: 'ink-700', hex: '#27272B', swatchClassName: 'bg-ink-700', textClassName: 'text-paper' },
  { label: 'ink-800', hex: '#1A1A1D', swatchClassName: 'bg-ink-800', textClassName: 'text-paper' },
  { label: 'ink-900', hex: '#111113', swatchClassName: 'bg-ink-900', textClassName: 'text-paper' },
  { label: 'ink-950', hex: '#0A0A0B', swatchClassName: 'bg-ink-950', textClassName: 'text-paper' },
];

const ACCENTS: Swatch[] = [
  { label: 'lime-400', hex: '#D6F771', swatchClassName: 'bg-lime-400', textClassName: 'text-ink-950' },
  { label: 'lime-500', hex: '#C6F24A', swatchClassName: 'bg-lime-500', textClassName: 'text-ink-950' },
  { label: 'lime-600', hex: '#9FC72E', swatchClassName: 'bg-lime-600', textClassName: 'text-ink-950' },
  { label: 'route-500', hex: '#2B6BFF', swatchClassName: 'bg-route-500', textClassName: 'text-paper' },
];

const SEMANTIC_SCALES: { name: string; steps: Swatch[] }[] = [
  {
    name: 'success',
    steps: [
      { label: '100', hex: '#E3F8ED', swatchClassName: 'bg-success-100', textClassName: 'text-ink-950' },
      { label: '200', hex: '#C3F0DA', swatchClassName: 'bg-success-200', textClassName: 'text-ink-950' },
      { label: '300', hex: '#93E4BE', swatchClassName: 'bg-success-300', textClassName: 'text-ink-950' },
      { label: '400', hex: '#5CD39D', swatchClassName: 'bg-success-400', textClassName: 'text-ink-950' },
      { label: '500', hex: '#2BB673', swatchClassName: 'bg-success-500', textClassName: 'text-paper' },
      { label: '600', hex: '#1F9760', swatchClassName: 'bg-success-600', textClassName: 'text-paper' },
      { label: '700', hex: '#16754A', swatchClassName: 'bg-success-700', textClassName: 'text-paper' },
    ],
  },
  {
    name: 'warning',
    steps: [
      { label: '100', hex: '#FEF7E7', swatchClassName: 'bg-warning-100', textClassName: 'text-ink-950' },
      { label: '200', hex: '#FCEAC0', swatchClassName: 'bg-warning-200', textClassName: 'text-ink-950' },
      { label: '300', hex: '#F9D888', swatchClassName: 'bg-warning-300', textClassName: 'text-ink-950' },
      { label: '400', hex: '#F7C860', swatchClassName: 'bg-warning-400', textClassName: 'text-ink-950' },
      { label: '500', hex: '#F5B93A', swatchClassName: 'bg-warning-500', textClassName: 'text-ink-950' },
      { label: '600', hex: '#D69A1E', swatchClassName: 'bg-warning-600', textClassName: 'text-paper' },
      { label: '700', hex: '#A97714', swatchClassName: 'bg-warning-700', textClassName: 'text-paper' },
    ],
  },
  {
    name: 'danger',
    steps: [
      { label: '100', hex: '#FCE7E7', swatchClassName: 'bg-danger-100', textClassName: 'text-ink-950' },
      { label: '200', hex: '#F9C9CB', swatchClassName: 'bg-danger-200', textClassName: 'text-ink-950' },
      { label: '300', hex: '#F3999D', swatchClassName: 'bg-danger-300', textClassName: 'text-ink-950' },
      { label: '400', hex: '#EC6A70', swatchClassName: 'bg-danger-400', textClassName: 'text-paper' },
      { label: '500', hex: '#E5484D', swatchClassName: 'bg-danger-500', textClassName: 'text-paper' },
      { label: '600', hex: '#C22F35', swatchClassName: 'bg-danger-600', textClassName: 'text-paper' },
      { label: '700', hex: '#972327', swatchClassName: 'bg-danger-700', textClassName: 'text-paper' },
    ],
  },
  {
    name: 'info',
    steps: [
      { label: '100', hex: '#EDF3FF', swatchClassName: 'bg-info-100', textClassName: 'text-ink-950' },
      { label: '200', hex: '#CBDAFF', swatchClassName: 'bg-info-200', textClassName: 'text-ink-950' },
      { label: '300', hex: '#A8C2FF', swatchClassName: 'bg-info-300', textClassName: 'text-ink-950' },
      { label: '400', hex: '#5A8CFF', swatchClassName: 'bg-info-400', textClassName: 'text-paper' },
      { label: '500', hex: '#2B6BFF', swatchClassName: 'bg-info-500', textClassName: 'text-paper' },
      { label: '600', hex: '#1F52D6', swatchClassName: 'bg-info-600', textClassName: 'text-paper' },
      { label: '700', hex: '#173EA3', swatchClassName: 'bg-info-700', textClassName: 'text-paper' },
    ],
  },
];

const TYPE_SCALE: { token: string; className: string; px: string; usage: string }[] = [
  { token: 'display', className: 'text-display', px: '34/40', usage: 'Hero — 1 por pantalla, uso puntual' },
  { token: 'title', className: 'text-title', px: '24/30', usage: 'Título de pantalla' },
  { token: 'h2', className: 'text-h2', px: '20/26', usage: 'Encabezado de sección' },
  { token: 'h3', className: 'text-h3', px: '17/22', usage: 'Encabezado de card / item' },
  { token: 'body', className: 'text-body', px: '15/22', usage: 'Texto de lectura por defecto' },
  { token: 'small', className: 'text-small', px: '13/18', usage: 'Texto secundario, ayudas' },
  { token: 'caption', className: 'text-caption', px: '11/14', usage: 'Labels, eyebrows, metadata' },
];

const SEMANTIC_TOKENS: { label: string; className: string; kind: 'bg' | 'text' | 'border' }[] = [
  { label: 'bg', className: 'bg-bg', kind: 'bg' },
  { label: 'bg-sub', className: 'bg-bg-sub', kind: 'bg' },
  { label: 'bg-mute', className: 'bg-bg-mute', kind: 'bg' },
  { label: 'fg', className: 'text-fg', kind: 'text' },
  { label: 'fg-2', className: 'text-fg-2', kind: 'text' },
  { label: 'fg-3', className: 'text-fg-3', kind: 'text' },
  { label: 'border', className: 'border-border', kind: 'border' },
  { label: 'border-strong', className: 'border-border-strong', kind: 'border' },
];

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="font-sans-semibold text-h3 text-fg" testID={`section-${children}`}>
      {children}
    </Text>
  );
}

function ColorSwatch({ item }: { item: Swatch }) {
  return (
    <View className="w-20 gap-1">
      <View
        className={`h-14 w-20 items-start justify-end rounded-md p-2 ${item.swatchClassName}`}
      >
        <Text className={`font-sans-medium text-caption ${item.textClassName}`}>
          {item.label}
        </Text>
      </View>
      <Text className="font-sans text-caption text-fg-3">{item.hex}</Text>
    </View>
  );
}

export default function DevTokensScreen() {
  const { colorScheme: scheme } = useColorScheme();
  const isDark = scheme === 'dark';

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between border-b border-border px-6 pb-4 pt-24">
        <View className="gap-0.5">
          <Text className="font-sans-medium text-caption uppercase tracking-widest text-fg-3">
            Movo · Design tokens
          </Text>
          <Text className="font-sans-semibold text-title text-fg">
            Preview de tokens
          </Text>
        </View>
        <Text
          onPress={() => colorScheme.set(isDark ? 'light' : 'dark')}
          className="rounded-full border border-border-strong px-4 py-2 font-sans-medium text-small text-fg"
          testID="theme-toggle"
        >
          {isDark ? '☀ Modo claro' : '☾ Modo oscuro'}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-10 px-6 pb-16 pt-8"
      >
        <View className="gap-3">
          <SectionTitle>Jerarquía tipográfica</SectionTitle>
          <View className="gap-4 rounded-xl border border-border bg-bg-sub p-5">
            {TYPE_SCALE.map((item) => (
              <View key={item.token} className="flex-row items-baseline gap-4">
                <View className="w-16">
                  <Text className="font-sans text-caption text-fg-3">
                    {item.px}
                  </Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className={`font-sans-semibold text-fg ${item.className}`}>
                    {item.token}
                  </Text>
                  <Text className="font-sans text-caption text-fg-3">
                    {item.usage}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View className="gap-3">
          <SectionTitle>Neutros</SectionTitle>
          <View className="flex-row flex-wrap gap-3">
            {NEUTRALS.map((item) => (
              <ColorSwatch key={item.label} item={item} />
            ))}
          </View>
        </View>

        <View className="gap-3">
          <SectionTitle>Acentos vivos</SectionTitle>
          <View className="flex-row flex-wrap gap-3">
            {ACCENTS.map((item) => (
              <ColorSwatch key={item.label} item={item} />
            ))}
          </View>
        </View>

        <View className="gap-3">
          <SectionTitle>Semánticos</SectionTitle>
          {SEMANTIC_SCALES.map((scale) => (
            <View key={scale.name} className="gap-2">
              <Text className="font-sans text-caption uppercase tracking-wide text-fg-3">
                {scale.name}
              </Text>
              <View className="flex-row flex-wrap gap-3">
                {scale.steps.map((step) => (
                  <ColorSwatch key={`${scale.name}-${step.label}`} item={step} />
                ))}
              </View>
            </View>
          ))}
        </View>

        <View className="gap-3">
          <SectionTitle>Tokens semánticos (light/dark)</SectionTitle>
          <Text className="font-sans text-small text-fg-2">
            Cambian solos con el tema del sistema, o con el toggle de arriba.
          </Text>
          <View className="flex-row flex-wrap gap-3">
            {SEMANTIC_TOKENS.map((token) => (
              <View key={token.label} className="w-20 gap-1">
                {token.kind === 'border' ? (
                  <View
                    className={`h-14 w-20 items-center justify-center rounded-md bg-bg-sub ${token.className}`}
                    style={{ borderWidth: 2 }}
                  >
                    <Text className="font-sans text-caption text-fg-3">
                      {token.label}
                    </Text>
                  </View>
                ) : token.kind === 'bg' ? (
                  <View
                    className={`h-14 w-20 items-start justify-end rounded-md border border-border p-2 ${token.className}`}
                  >
                    <Text className="font-sans-medium text-caption text-fg">
                      {token.label}
                    </Text>
                  </View>
                ) : (
                  <View className="h-14 w-20 items-center justify-center rounded-md border border-border bg-bg-sub">
                    <Text className={`font-sans-semibold text-h3 ${token.className}`}>
                      Aa
                    </Text>
                  </View>
                )}
                <Text className="font-sans text-caption text-fg-3">
                  {token.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="gap-3">
          <SectionTitle>Familias tipográficas</SectionTitle>
          <View className="gap-4 rounded-xl border border-border bg-bg-sub p-5">
            <View className="gap-1">
              <Text className="font-sans text-caption text-fg-3">
                Inter · font-sans / font-sans-medium / font-sans-semibold
              </Text>
              <Text className="font-sans text-h2 text-fg">
                Movo conecta a quienes viajan.
              </Text>
              <Text className="font-sans-medium text-h2 text-fg">
                Movo conecta a quienes viajan.
              </Text>
              <Text className="font-sans-semibold text-h2 text-fg">
                Movo conecta a quienes viajan.
              </Text>
            </View>
            <View style={{ height: 1 }} className="bg-border" />
            <View className="gap-1">
              <Text className="font-mono text-caption text-fg-3">
                JetBrains Mono · font-mono / font-mono-medium / font-mono-semibold
              </Text>
              <Text className="font-mono text-body text-fg">
                #C6F24A · MOVO-73
              </Text>
              <Text className="font-mono-medium text-body text-fg">
                #C6F24A · MOVO-73
              </Text>
              <Text className="font-mono-semibold text-body text-fg">
                #C6F24A · MOVO-73
              </Text>
            </View>
          </View>
        </View>

        <Link href="/dev-connection" className="font-sans text-small text-fg-3 underline" testID="dev-tokens-go-connection">
          Ver conexión al backend →
        </Link>
      </ScrollView>
    </View>
  );
}
