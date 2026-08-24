import { useEffect, useState } from "react";

/** `setTimeout` desborda con delays mayores a 2^31-1 ms y dispara al instante:
 * para plazos lejanos se reprograma por tramos en vez de agendar el total. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Devuelve si `deadline` ya pasó, re-renderizando el componente en el momento
 * exacto en que vence (MOVO-130 AC5). Sin esto, el vencimiento solo se notaba en
 * el siguiente render por otra causa: el receptor con el detalle abierto seguía
 * viendo la barra de aceptar/rechazar después del plazo y solo se enteraba al
 * tocar y comerse el 409 del backend.
 *
 * Agenda un único timeout al instante del vencimiento en vez de un intervalo —
 * no hay nada que actualizar entre medio (la etiqueta de tiempo restante es
 * estática) y evita un timer despertando la app cada segundo.
 */
export function useDeadlineExpired(deadline: string | null | undefined): boolean {
  const deadlineMs = deadline != null ? new Date(deadline).getTime() : NaN;
  const [, setTick] = useState(0);
  const isExpired = Number.isFinite(deadlineMs) && deadlineMs <= Date.now();

  useEffect(() => {
    if (!Number.isFinite(deadlineMs)) return;

    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) return;

    // Al vencer (o al agotarse un tramo intermedio de un plazo muy lejano) fuerza
    // un render: el propio render recalcula `isExpired` contra el reloj real.
    const timer = setTimeout(() => setTick((tick) => tick + 1), Math.min(remaining, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  });

  return isExpired;
}
