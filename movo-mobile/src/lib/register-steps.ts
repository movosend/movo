/**
 * Pasos del asistente de registro: 0 email y teléfono, 1 código SMS, 2 contraseña, 3 revisión.
 *
 * Si el teléfono ya está verificado, el paso del código se saltea en las dos direcciones y deja
 * de contar: la barra y la etiqueta ("Paso 2") reflejan solo los pasos que la persona va a ver,
 * así no salta dos tramos de golpe ni dice "Paso 3" cuando es el segundo.
 */
export type RegisterStep = 0 | 1 | 2 | 3;

const ALL_STEPS: readonly RegisterStep[] = [0, 1, 2, 3];
const OTP_STEP: RegisterStep = 1;

export function visibleRegisterSteps(otpSkipped: boolean): readonly RegisterStep[] {
  return otpSkipped ? ALL_STEPS.filter((s) => s !== OTP_STEP) : ALL_STEPS;
}

export function registerStepProgress(
  step: RegisterStep,
  otpSkipped: boolean,
): { position: number; total: number; fraction: number; label: string } {
  const steps = visibleRegisterSteps(otpSkipped);
  const total = steps.length;
  // Nunca se está parado en el paso del código con el código salteado, pero por las dudas no
  // se devuelve una posición negativa.
  const position = Math.max(steps.indexOf(step), 0) + 1;
  return { position, total, fraction: position / total, label: `Paso ${position}` };
}
