import { SECURE_STORE_KEYS, secureStore } from "./secure-store";

/**
 * Flag de "ya viste el carrusel de onboarding" (MOVO-249) — gatea el redirect
 * automático de `app/index.tsx`. Wrapper mínimo sobre `secureStore` (mismo criterio
 * que `device-id.ts`/`use-legal-acceptance-entry.ts`): quien decide CUÁNDO mostrar el
 * onboarding es el caller, esto solo persiste el hecho.
 */
export async function hasSeenOnboarding(): Promise<boolean> {
  const value = await secureStore.getItem(SECURE_STORE_KEYS.hasSeenOnboarding);
  return value === "1";
}

export function markOnboardingSeen(): Promise<void> {
  return secureStore.setItem(SECURE_STORE_KEYS.hasSeenOnboarding, "1");
}
