import { router } from "expo-router";

/** Ventana en la que un segundo `push` a la misma ruta se considera un doble tap. */
const DUPLICATE_PUSH_WINDOW_MS = 800;

let lastHref: string | null = null;
let lastAt = 0;

/**
 * MOVO-301: `router.push` que ignora un segundo toque a la misma ruta dentro de una ventana corta.
 * Un doble tap en un acceso al chat (card de Inicio, detalle, lista de Chats) apilaba dos copias de
 * la conversación y al salir se volvía a entrar a la otra. Es un guard de toque, no de pila: abrir
 * la misma ruta más tarde, a propósito, sigue funcionando.
 */
export function pushOnce(href: string): void {
  const now = Date.now();
  if (href === lastHref && now - lastAt < DUPLICATE_PUSH_WINDOW_MS) return;
  lastHref = href;
  lastAt = now;
  router.push(href as never);
}

/** Solo para tests de pantallas que tocan la misma ruta más de una vez en menos de la ventana. */
export function resetNavigationGuard(): void {
  lastHref = null;
  lastAt = 0;
}
