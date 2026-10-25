/**
 * MOVO-317: tamaños predeterminados del wizard (pequeño, mediano, grande). Cargan peso y medidas de un
 * toque; el emisor puede ajustar cada valor después. Las medidas son opciones del desplegable (múltiplos de
 * 10 cm) y el peso un múltiplo de 0,5 kg. Se guardan como string, igual que el resto del store del wizard.
 */
export type PackagePresetId = "small" | "medium" | "large";

export interface PackagePreset {
  id: PackagePresetId;
  label: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

export const PACKAGE_PRESETS: readonly PackagePreset[] = [
  { id: "small", label: "Pequeño", weightKg: "2", lengthCm: "30", widthCm: "20", heightCm: "20" },
  { id: "medium", label: "Mediano", weightKg: "8", lengthCm: "50", widthCm: "40", heightCm: "30" },
  { id: "large", label: "Grande", weightKg: "25", lengthCm: "100", widthCm: "60", heightCm: "60" },
];

interface PackageValues {
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

/** El preset cuyos cuatro valores coinciden con los del wizard, o `null` si se ajustó alguno a mano. */
export function matchingPackagePreset(values: PackageValues): PackagePreset | null {
  return (
    PACKAGE_PRESETS.find(
      (preset) =>
        Number(preset.weightKg) === Number(values.weightKg) &&
        preset.lengthCm === values.lengthCm &&
        preset.widthCm === values.widthCm &&
        preset.heightCm === values.heightCm,
    ) ?? null
  );
}

/** Texto corto de las medidas de un preset: `30 × 20 × 20 cm`. */
export function presetDimensionsLabel(preset: PackagePreset): string {
  return `${preset.lengthCm} × ${preset.widthCm} × ${preset.heightCm} cm`;
}
