/**
 * MOVO-138 (ADR-025): definición de la zona de demanda que `svc-shipments` cuenta y
 * manda como `demandContext` a `POST /quote` de `movo-svc-pricing-logistics`.
 *
 * Constantes y no env vars a propósito: definen QUÉ se mide, no cuánto se cobra. El
 * umbral de alta demanda (3,0 / mínimo 4, `PRICING_DEMAND_*` del lado de pricing) se
 * calibró con Monte Carlo sobre conteos en estos radios y ventanas (spike MOVO-216,
 * §4.3): cambiarlos invalida esa calibración y tiene que pasar por un PR con su
 * justificación, no por un override de deploy.
 *
 * No se reusa `TRIP_DEFAULT_MAX_DETOUR_KM` aunque hoy valga lo mismo: ese es el desvío
 * por default del feed de matches y un transportista puede cambiarlo; atarlos haría
 * que tocar el feed mueva el pricing sin que nadie lo note.
 */

/** Radio alrededor del retiro cotizado. Mismo umbral que el prefiltro de corredor de
 * MOVO-50: un transportista cuenta como oferta si el feed le mostraría el paquete. */
export const DEMAND_ZONE_RADIUS_KM = 15;

/** Un viaje cuenta como oferta si sale entre 6 h antes y 72 h después de ahora. */
export const DEMAND_TRIP_WINDOW_PAST_HOURS = 6;
export const DEMAND_TRIP_WINDOW_FUTURE_HOURS = 72;
