import { useEffect, useMemo, useRef } from "react";
/** Lo único que necesita para distinguir lo que llega en vivo: el tipo y la key de cada ítem. */
type KeyedItem = { kind: string; key: string };

/**
 * Hasta cuántos mensajes nuevos al frente se consideran "en vivo" y se animan. Más que eso es una carga en bloque (el
 * refetch al volver de segundo plano trae decenas de golpe): se muestran sin animar, como el historial.
 */
export const MAX_ANIMATED_ARRIVALS = 3;

/**
 * MOVO-301: distingue lo que llega EN VIVO de lo que ya estaba (historial al abrir, páginas más viejas). La lista va del
 * más nuevo al más viejo, así que un mensaje es nuevo si no estaba antes y queda delante del que era el más nuevo; lo que
 * se agrega al final es paginación.
 *
 * Es una función pura de `(timeline, lo ya confirmado)`: las keys vistas se guardan en un `useEffect` (al confirmarse el
 * render), no durante el render, así un render descartado o doble no pierde ni duplica llegadas. Una burbuja decide si se
 * anima al MONTARSE; después, como la key ya es "vista", ninguna re-renderización ni volver a montarla por virtualización
 * la anima de nuevo, sin necesidad de temporizadores.
 *
 * - `arrivals`: todos los mensajes nuevos al frente (para el contador de "nuevos" y el scroll al enviar).
 * - `liveKeys`: de esos, los que se animan; vacío si es una carga en bloque (> `MAX_ANIMATED_ARRIVALS`).
 */
export function useLiveChatKeys<T extends KeyedItem>(timeline: readonly T[], ready: boolean) {
  const seenKeysRef = useRef<ReadonlySet<string>>(new Set());
  const seenHeadRef = useRef<string | undefined>(undefined);
  const baselineDoneRef = useRef(false);

  const result = useMemo(() => {
    let arrivals: T[] = [];
    if (baselineDoneRef.current && timeline.length > 0) {
      const headIndex = seenHeadRef.current === undefined ? timeline.length : timeline.findIndex((i) => i.key === seenHeadRef.current);
      if (headIndex > 0) {
        arrivals = timeline.slice(0, headIndex).filter((i) => i.kind === "message" && !seenKeysRef.current.has(i.key));
      }
    }
    const animated = arrivals.length <= MAX_ANIMATED_ARRIVALS ? arrivals : [];
    return { arrivals, liveKeys: new Set(animated.map((i) => i.key)) as ReadonlySet<string> };
  }, [timeline]);

  useEffect(() => {
    seenKeysRef.current = new Set(timeline.map((i) => i.key));
    seenHeadRef.current = timeline[0]?.key;
    if (ready) baselineDoneRef.current = true;
  }, [timeline, ready]);

  return result;
}
