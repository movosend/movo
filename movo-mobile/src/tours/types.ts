import type { TourId, UserTourRecord } from "@movo/shared/dist/config/tours";

/**
 * MOVO-169: datos que deciden qué pasos se muestran y con qué texto. Se congelan al
 * arrancar el tour (`tour-store.ts#startTour`): un paso con `when` falso no entra en la
 * lista, así el "Paso X de N" se cuenta sobre los pasos que de verdad se van a ver.
 */
export interface TourContext {
  firstName: string | null;
  /** `resolveTransportGate` sin bloqueo (ver `use-transport-gate.ts`). */
  canBrowse: boolean;
  /** Hay al menos un envío en el feed de Transportar. */
  hasFeed: boolean;
}

/** Pantallas por las que pasa un tour: el overlay navega a la del paso si no está ahí. */
export type TourRoute = "/home" | "/transport";

export interface TourStep {
  id: string;
  /** Sin ancla el paso es un modal centrado. */
  anchorId?: string;
  route?: TourRoute;
  when?: (context: TourContext) => boolean;
  title: string | ((context: TourContext) => string);
  body: string;
  /** Se corre antes de medir el ancla; devuelve cuántos ms esperar (ej. la animación de la tab bar). */
  beforeShow?: () => number;
}

export interface TourDefinition {
  id: TourId;
  /** Subirla vuelve a mostrar el tour a quien ya lo vio (cambios grandes de la app). */
  version: number;
  icon: "package" | "truck";
  steps: TourStep[];
}

/**
 * El tour se muestra solo si no hay registro, o si el registrado es de una versión anterior.
 * `recorded` puede traer varios registros del mismo tour (perfil + pendientes locales): vale
 * la mayor versión, así un refetch del perfil con una versión vieja no pisa un pendiente más nuevo.
 */
export function shouldAutoShowTour(definition: TourDefinition, recorded: readonly UserTourRecord[]): boolean {
  const seenVersion = recorded.reduce(
    (max, item) => (item.tourId === definition.id ? Math.max(max, item.version) : max),
    0,
  );
  return seenVersion < definition.version;
}

export function resolveStepTitle(step: TourStep, context: TourContext): string {
  return typeof step.title === "function" ? step.title(context) : step.title;
}
