import { useRef } from "react";
import type { ChatTimelineItem } from "../lib/chat-format";

/** Cuánto vive una key como "en vivo": pasado esto, volver a montar la burbuja ya no la anima. */
const LIVE_KEY_TTL_MS = 800;

interface LiveState {
  timeline: readonly ChatTimelineItem[] | null;
  keys: string[];
  baselineDone: boolean;
  live: Set<string>;
  arrivals: ChatTimelineItem[];
}

/**
 * MOVO-301: distingue lo que llega EN VIVO de lo que ya estaba (historial al abrir, páginas más
 * viejas). La lista va del más nuevo al más viejo, así que un mensaje es en vivo si es nuevo y
 * queda antes del que era el más nuevo; lo que se agrega al final es paginación.
 *
 * Se calcula durante el render porque `entering` solo corre al montar la burbuja: un efecto
 * llegaría tarde. Es idempotente por identidad del `timeline`, así que re-renders y el doble
 * render de StrictMode no lo duplican. `liveKeys` es mutable a propósito (sin re-render): cada
 * key se retira sola pasado `LIVE_KEY_TTL_MS`, y una burbuja que se vuelve a montar al volver a
 * entrar en pantalla (virtualización) no repite la animación.
 */
export function useLiveChatKeys(timeline: readonly ChatTimelineItem[], ready: boolean) {
  const ref = useRef<LiveState>({ timeline: null, keys: [], baselineDone: false, live: new Set(), arrivals: [] });
  const state = ref.current;
  if (state.timeline !== timeline) {
    const keys = timeline.map((item) => item.key);
    let arrivals: ChatTimelineItem[] = [];
    if (state.baselineDone && keys.length > 0) {
      const known = new Set(state.keys);
      const oldHead = state.keys[0];
      const headIndex = oldHead === undefined ? keys.length : keys.indexOf(oldHead);
      if (headIndex > 0) {
        arrivals = timeline.slice(0, headIndex).filter((item) => item.kind === "message" && !known.has(item.key));
      }
    }
    for (const item of arrivals) {
      state.live.add(item.key);
      setTimeout(() => state.live.delete(item.key), LIVE_KEY_TTL_MS);
    }
    state.timeline = timeline;
    state.keys = keys;
    state.arrivals = arrivals;
    if (ready && !state.baselineDone) state.baselineDone = true;
  }
  return { liveKeys: state.live as ReadonlySet<string>, arrivals: state.arrivals };
}
