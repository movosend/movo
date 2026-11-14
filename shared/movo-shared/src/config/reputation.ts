/**
 * Calificaciones que hacen falta para mostrar el puntaje (AC2 de MOVO-25): con menos, el perfil (o la pestaña de un rol)
 * es "nuevo" y no muestra número. Una sola copia para `svc-shipments`, que lo aplica, y el mobile, que avisa cuántas faltan.
 * Sin dependencias de Node: el mobile lo importa por subpath (`dist/config/reputation`).
 */
export const MIN_RATINGS_FOR_ESTABLISHED_PROFILE = 3;
