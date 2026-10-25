import { Pressable, Text, View } from "react-native";
import {
  PACKAGE_PRESETS,
  matchingPackagePreset,
  presetDimensionsLabel,
  type PackagePreset,
} from "../../src/lib/package-presets";

interface PackagePresetsProps {
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  onSelect: (preset: PackagePreset) => void;
  testID?: string;
}

/**
 * Tres atajos de tamaño (pequeño, mediano, grande) que cargan peso y medidas de un toque (MOVO-317).
 * Mismo estilo que los botones de tipo de paquete (`CategoryGrid`); queda marcado el que coincide con
 * los valores actuales, y deja de estarlo apenas el emisor ajusta alguno a mano.
 */
export function PackagePresets({ weightKg, lengthCm, widthCm, heightCm, onSelect, testID }: PackagePresetsProps) {
  const active = matchingPackagePreset({ weightKg, lengthCm, widthCm, heightCm });

  return (
    <View testID={testID} className="flex-row gap-2">
      {PACKAGE_PRESETS.map((preset) => {
        const selected = active?.id === preset.id;
        return (
          <Pressable
            key={preset.id}
            testID={testID ? `${testID}-${preset.id}` : undefined}
            onPress={() => onSelect(preset)}
            className={`flex-1 rounded-[10px] border px-3 py-3 ${
              selected ? "border-fg bg-fg" : "border-border-strong bg-bg"
            }`}
          >
            <Text
              className={`font-sans-semibold text-[13px] ${selected ? "text-white dark:text-ink-950" : "text-fg"}`}
              numberOfLines={1}
            >
              {preset.label}
            </Text>
            <Text
              className={`mt-0.5 font-sans text-[11px] ${selected ? "text-white/60 dark:text-ink-950/50" : "text-fg-3"}`}
              numberOfLines={1}
            >
              {presetDimensionsLabel(preset)}
            </Text>
            <Text
              className={`font-sans text-[11px] ${selected ? "text-white/60 dark:text-ink-950/50" : "text-fg-3"}`}
              numberOfLines={1}
            >
              {preset.weightKg} kg
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
