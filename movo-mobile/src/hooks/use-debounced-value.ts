import { useEffect, useState } from "react";

/** Devuelve `value` recién `delayMs` después de su último cambio — usado por la
 * búsqueda de receptor del wizard de envíos (MOVO-83) para no disparar un request
 * por cada tecla. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
