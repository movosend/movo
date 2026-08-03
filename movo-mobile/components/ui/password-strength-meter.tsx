import { Check } from 'lucide-react-native';
import { Text, View } from 'react-native';

interface PasswordStrengthMeterProps {
  password: string;
  testID?: string;
}

const CRITERIA = [
  { key: 'length', label: 'Mínimo 8 caracteres', test: (v: string) => v.length >= 8 },
  { key: 'letter', label: 'Al menos una letra', test: (v: string) => /[A-Za-z]/.test(v) },
  { key: 'digit', label: 'Al menos un número', test: (v: string) => /\d/.test(v) },
];

/**
 * 3 niveles porque hay 3 criterios (largo, letra, número) — coinciden 1:1
 * con `isPasswordValid` de `use-registration.tsx`, así que "Fuerte" implica
 * contraseña válida para el backend.
 */
const LEVELS = [
  { label: 'Débil', textClass: 'text-danger-500', barClass: 'bg-danger-500', checkClass: 'bg-danger-500' },
  { label: 'Media', textClass: 'text-warning-600', barClass: 'bg-warning-500', checkClass: 'bg-warning-500' },
  { label: 'Fuerte', textClass: 'text-success-500', barClass: 'bg-success-500', checkClass: 'bg-success-500' },
];

export function PasswordStrengthMeter({ password, testID }: PasswordStrengthMeterProps) {
  if (!password) return null;

  const criteria = CRITERIA.map((c) => ({ ...c, met: c.test(password) }));
  const metCount = criteria.filter((c) => c.met).length;
  const level = metCount <= 1 ? LEVELS[0] : metCount === 2 ? LEVELS[1] : LEVELS[2];

  return (
    <View testID={testID} className="mb-4">
      <View className="mb-2 flex-row gap-1">
        {criteria.map((c, i) => (
          <View
            key={c.key}
            className={`h-1 flex-1 rounded-full ${i < metCount ? level.barClass : 'bg-ink-200'}`}
          />
        ))}
      </View>
      <Text testID={testID ? `${testID}-label` : undefined} className={`mb-2 font-sans-semibold text-[12px] ${level.textClass}`}>
        {level.label}
      </Text>
      <View className="gap-1.5">
        {criteria.map((c) => (
          <View key={c.key} className="flex-row items-center gap-2">
            {c.met ? (
              <View className={`h-3.5 w-3.5 items-center justify-center rounded-full ${level.checkClass}`}>
                <Check size={10} color="#FFFFFF" strokeWidth={3} />
              </View>
            ) : (
              <View className="h-3.5 w-3.5 rounded-full border border-ink-300" />
            )}
            <Text className={`font-sans text-[12px] ${c.met ? 'text-ink-950' : 'text-fg-2'}`}>{c.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
