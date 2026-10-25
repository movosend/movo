import { ApiError, argentinaWeekday, toArgentinaCalendarDateString } from "@movo/shared";
import { TripStatus, UpdateTripInput } from "../models/trip";

/** DD-042 (punto 8): ocurrencias seguidas vencidas que cortan la serie ("serie fantasma"). */
export const PHANTOM_SERIES_STREAK = 3;

/**
 * MOVO-265 (DD-042, punto 6): reglas de una recurrencia prendida. El schema de AJV ya
 * rechaza días repetidos o fuera de rango; se repiten acá para que la regla no dependa de
 * por dónde entre el dato. 400 `VALIDATION_FAILED`, como el resto de las validaciones de
 * negocio del servicio.
 */
export function validateRecurrence(params: { weekdays: number[]; until: string | null; departureAt: Date }): void {
  const { weekdays, until, departureAt } = params;
  if (weekdays.length === 0) {
    throw new ApiError(400, "VALIDATION_FAILED", "Elegí al menos un día en que se repite el viaje.");
  }
  if (new Set(weekdays).size !== weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new ApiError(400, "VALIDATION_FAILED", "Los días de la recurrencia tienen que ser distintos y entre 0 y 6.");
  }
  if (!weekdays.includes(argentinaWeekday(departureAt))) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "El día de salida del viaje tiene que ser uno de los días en que se repite.",
    );
  }
  if (until !== null && until <= toArgentinaCalendarDateString(departureAt)) {
    throw new ApiError(400, "VALIDATION_FAILED", "La fecha de fin de la recurrencia tiene que ser posterior a la salida.");
  }
}

/**
 * MOVO-265 (DD-042, punto 6): un viaje con paquetes aceptados no se edita. La única
 * excepción es apagar la recurrencia (`recurrenceWeekdays: null`, con o sin
 * `recurrenceUntil: null`), porque no cambia ese viaje concreto y es la única forma de cortar
 * una serie cuyo vigente ya tiene paquetes. Cambiar los días o la fecha de fin, o prender la
 * recurrencia, sigue la regla de siempre: si quiere otro patrón, declara un viaje nuevo.
 */
export function isStopRecurrencePatch(input: UpdateTripInput): boolean {
  const touched = Object.entries(input).filter(([, value]) => value !== undefined);
  return (
    input.recurrenceWeekdays === null &&
    touched.every(([key, value]) => key === "recurrenceWeekdays" || (key === "recurrenceUntil" && value === null))
  );
}

/**
 * MOVO-265 (DD-042, punto 8): la serie es fantasma si las últimas `PHANTOM_SERIES_STREAK`
 * ocurrencias (del más nuevo al más viejo, el vigente incluido) terminaron todas `expired`.
 * Cuenta cualquier `expired` (un `declared` vencido o un `active` que se quedó sin paquetes);
 * una `cancelled` por el usuario corta la racha.
 */
export function isPhantomSeries(recentStatuses: TripStatus[]): boolean {
  return (
    recentStatuses.length >= PHANTOM_SERIES_STREAK &&
    recentStatuses.slice(0, PHANTOM_SERIES_STREAK).every((status) => status === TripStatus.EXPIRED)
  );
}
