import { useEffect, useRef, useState } from "react";

/**
 * Cuenta regresiva del cooldown de reenvío de OTP (60s del backend, ver
 * `OTP_RESEND_COOLDOWN_SECONDS` en `movo-svc-users`). Extraído del wizard de
 * registro (MOVO-73), donde vivía como un `useState` + `useEffect` sueltos dentro
 * de `RegisterScreen`; MOVO-135 lo necesita también en los sub-flujos de cambio de
 * teléfono y email.
 *
 * A diferencia de la versión original, el `setInterval` se crea una sola vez por
 * cuenta regresiva (no en cada tick) y el tiempo restante se recalcula contra un
 * `Date.now()` de referencia — así no deriva ni se congela si la app pasa por
 * background a mitad del conteo.
 */
export function useOtpCooldown() {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 500);
    return () => clearInterval(timer);
    // Solo re-engancha al arrancar/terminar una cuenta, no en cada tick.
  }, [secondsLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  function start(seconds: number) {
    if (seconds <= 0) {
      deadlineRef.current = null;
      setSecondsLeft(0);
      return;
    }
    deadlineRef.current = Date.now() + seconds * 1000;
    setSecondsLeft(seconds);
  }

  return { secondsLeft, start };
}

/**
 * `mm:ss` para el contador visible. El wizard de registro formateaba a mano como
 * `` `00:${String(s).padStart(2, "0")}` ``, que se rompe apenas el cooldown pasa de
 * 99 segundos (mostraría "00:120"). Hoy el backend devuelve 60, pero el formato no
 * tiene por qué depender de eso.
 */
export function formatCooldown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
