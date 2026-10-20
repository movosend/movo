import type { TourOutcome } from "@movo/shared/dist/config/tours";
import { router, usePathname } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRecordTour } from "../../src/hooks/use-record-tour";
import { selectIsBlocked, useBlockingGatesStore } from "../../src/store/blocking-gates-store";
import { useTourStore, type TourAnchorEntry, type TourRect } from "../../src/store/tour-store";
import { TOURS } from "../../src/tours";
import { resolveStepTitle } from "../../src/tours/types";
import { TourModal, TourTooltip } from "./tour-controls";
import { TourSpotlight, type SpotlightHole } from "./tour-spotlight";

/** Si el ancla de un paso no aparece en este tiempo, el paso se saltea (AC3). */
export const TOUR_ANCHOR_TIMEOUT_MS = 1500;
const POLL_MS = 100;
/** Tiempo para que la pantalla de destino termine de montarse/asentarse. */
const NAVIGATION_SETTLE_MS = 300;
const SCROLL_SETTLE_MS = 350;
/** Tab bar flotante sobre el inset inferior (pill + margen + aire). */
const TAB_BAR_CLEARANCE = 80;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function toHole(rect: TourRect, entry: TourAnchorEntry): SpotlightHole {
  return {
    x: rect.x - entry.padding,
    y: rect.y - entry.padding,
    width: rect.width + entry.padding * 2,
    height: rect.height + entry.padding * 2,
    radius: entry.radius + entry.padding,
  };
}

/**
 * MOVO-169: overlay del tutorial, montado en `app/(app)/_layout.tsx` sobre toda la app
 * autenticada (incluida la tab bar). Es un `View` absoluto y no un `Modal`: dos `Modal`
 * no conviven en iOS, y mientras haya una pantalla bloqueante encima el tour espera oculto.
 *
 * Cada paso: navega a su pantalla si hace falta, espera a que su ancla se registre (hasta
 * `TOUR_ANCHOR_TIMEOUT_MS`, si no lo saltea), la lleva a la vista y la mide. El fondo traga
 * los toques, así el elemento resaltado no dispara nada a mitad del tour (AC1).
 */
export function TourOverlay() {
  const active = useTourStore((s) => s.active);
  const context = useTourStore((s) => s.context);
  const blocked = useBlockingGatesStore(selectIsBlocked);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { mutate: recordTour } = useRecordTour();
  const [hole, setHole] = useState<SpotlightHole | null>(null);

  const step = active ? active.steps[active.index] ?? null : null;
  const stepKey = active && step ? `${active.tourId}:${step.id}` : null;

  const end = useCallback(
    (outcome: TourOutcome) => {
      const finished = useTourStore.getState().finish();
      setHole(null);
      if (finished && !finished.manual) {
        recordTour({ tourId: finished.tourId, version: TOURS[finished.tourId].version, outcome });
      }
    },
    [recordTour],
  );

  // Se salteó el último paso que quedaba: el tour termina como completado.
  useEffect(() => {
    if (active && !step) end("completed");
  }, [active, step, end]);

  useEffect(() => {
    if (!step || blocked) return;
    let cancelled = false;
    setHole(null);
    const navigated = !!step.route && pathnameRef.current !== step.route;
    if (navigated && step.route) router.navigate(step.route);
    const anchorId = step.anchorId;
    if (!anchorId) return;

    const isOnScreen = (rect: TourRect) =>
      rect.y >= insets.top && rect.y + rect.height <= windowHeight - insets.bottom - TAB_BAR_CLEARANCE;

    void (async () => {
      const deadline = Date.now() + TOUR_ANCHOR_TIMEOUT_MS;
      const extraWait = Math.max(step.beforeShow?.() ?? 0, navigated ? NAVIGATION_SETTLE_MS : 0);
      if (extraWait > 0) await wait(extraWait);
      let entry = useTourStore.getState().anchors[anchorId];
      let rect = entry ? await entry.measure() : null;
      while (!rect && Date.now() < deadline) {
        await wait(POLL_MS);
        if (cancelled) return;
        entry = useTourStore.getState().anchors[anchorId];
        rect = entry ? await entry.measure() : null;
      }
      if (cancelled) return;
      if (rect && entry?.scrollIntoView && !isOnScreen(rect)) {
        entry.scrollIntoView();
        await wait(SCROLL_SETTLE_MS);
        if (cancelled) return;
        rect = await entry.measure();
      }
      if (cancelled) return;
      if (!rect || !entry) {
        useTourStore.getState().skipCurrentStep();
        return;
      }
      setHole(toHole(rect, entry));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se corre una vez por paso
  }, [stepKey, blocked]);

  const ready = !!step && !blocked && (!step.anchorId || hole !== null);
  const title = step ? resolveStepTitle(step, context) : "";
  const index = active?.index ?? 0;
  const count = active?.steps.length ?? 0;

  // AC7: el lector de pantalla anuncia paso, título y cuerpo apenas el paso se muestra.
  useEffect(() => {
    if (!ready || !step) return;
    AccessibilityInfo.announceForAccessibility(`Paso ${index + 1} de ${count}. ${title}. ${step.body}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stepKey]);

  if (!active || !step || blocked) return null;

  const controls = {
    title,
    body: step.body,
    index,
    count,
    onNext: () => (index === count - 1 ? end("completed") : useTourStore.getState().next()),
    onPrev: () => useTourStore.getState().prev(),
    onSkip: () => end("skipped"),
  };

  return (
    <View testID="tour-overlay" style={StyleSheet.absoluteFill}>
      {/* Traga los toques: lo resaltado no es interactivo durante el tour (AC1). */}
      <Pressable testID="tour-backdrop" accessible={false} style={StyleSheet.absoluteFill} onPress={() => undefined} />
      <TourSpotlight hole={step.anchorId ? hole : null} />
      {!step.anchorId ? (
        <TourModal key={stepKey} {...controls} icon={TOURS[active.tourId].icon} />
      ) : hole ? (
        <TourTooltip key={stepKey} {...controls} rect={hole} />
      ) : null}
    </View>
  );
}

/** Si el overlay está a la vista: el resto de la app queda oculto a los lectores de pantalla. */
export function useTourOverlayVisible() {
  const active = useTourStore((s) => s.active !== null);
  const blocked = useBlockingGatesStore(selectIsBlocked);
  return active && !blocked;
}
