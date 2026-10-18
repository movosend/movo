/**
 * MOVO-276: límites duros del paquete. Se validan acá, al cotizar y al crear el envío
 * (AC4), y también en `POST /quote` de `movo-svc-pricing-logistics`, que responde 422 con
 * el mismo criterio. Mismas env vars y defaults en los dos servicios
 * (`PACKAGE_MAX_WEIGHT_KG`, `PACKAGE_MAX_SIDE_CM`, `PACKAGE_MAX_SIDES_SUM_CM`).
 *
 * La suma de lados es lo que acota el volumen: con lados de hasta 150 cm cada uno, un
 * cubo de 150 cm (3,4 m³) pasaba el schema. Con 300 cm de suma, el mayor volumen posible
 * es el cubo de 100 cm (1 m³, un baúl).
 */
export interface PackageLimits {
  maxWeightKg: number;
  maxSideCm: number;
  maxSidesSumCm: number;
}

export const DEFAULT_PACKAGE_LIMITS: PackageLimits = {
  maxWeightKg: 30,
  maxSideCm: 150,
  maxSidesSumCm: 300,
};

export interface PackageMeasures {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

/** Cada límite excedido, en el orden peso → lado → suma. Vacío si el paquete entra. */
export function packageLimitViolations(pkg: PackageMeasures, limits: PackageLimits): string[] {
  const sides = [pkg.lengthCm, pkg.widthCm, pkg.heightCm];
  const longestSide = Math.max(...sides);
  const sidesSum = sides.reduce((a, b) => a + b, 0);
  const violations: string[] = [];
  if (pkg.weightKg > limits.maxWeightKg) {
    violations.push(`peso de ${fmt(pkg.weightKg)} kg (máximo ${fmt(limits.maxWeightKg)} kg)`);
  }
  if (longestSide > limits.maxSideCm) {
    violations.push(`lado de ${fmt(longestSide)} cm (máximo ${fmt(limits.maxSideCm)} cm)`);
  }
  if (sidesSum > limits.maxSidesSumCm) {
    violations.push(`suma de lados de ${fmt(sidesSum)} cm (máximo ${fmt(limits.maxSidesSumCm)} cm)`);
  }
  return violations;
}

// Mismo formato que el `:g` de Python en pricing: sin ceros de más, punto decimal.
function fmt(value: number): string {
  return String(Number(value.toFixed(2)));
}
