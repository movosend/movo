/**
 * MOVO-270 (ADR-052): umbrales de la atribución del no-retiro. La evidencia es pasiva (las
 * posiciones que el transportista ya reporta) y asimétrica a propósito: un falso "no llegó"
 * le cobra al transportista, un falso "llegó" solo lleva el envío a disputa. Por eso la
 * ausencia exige posiciones CLARAMENTE lejos y cualquier lectura intermedia (zona gris) deja
 * el caso sin evidencia.
 *
 * Todas las distancias se miden como `distancia(posición, retiro) − accuracyM`: el radio de
 * incertidumbre que informa el propio dispositivo juega a favor del transportista.
 */

/** Radio de llegada al punto de retiro. Los 100 m del handshake más margen por el geocoding de
 * la dirección (un pin corrido a la vereda de enfrente o al centro de la manzana) y por
 * estacionar a una cuadra. */
export const ARRIVAL_RADIUS_M = 250;

/** Precisión máxima de una posición para contar como evidencia, de llegada o de ausencia. Una
 * lectura peor no prueba nada en ningún sentido. */
export const ARRIVAL_MAX_ACCURACY_M = 100;

/** Distancia mínima para que una posición cuente como "estaba en otro lado". Entre
 * `ARRIVAL_RADIUS_M` y esto es zona gris: una sola posición ahí deja el caso sin evidencia.
 * Mismo radio que el aviso "está por llegar" (MOVO-240). */
export const ABSENCE_MIN_DISTANCE_M = 2000;

/** Cuánto antes del inicio de la ventana de retiro acordada empieza a contar la evidencia. Un
 * transportista que pasa por la puerta horas antes no "llegó" al retiro. */
export const ARRIVAL_EARLY_MARGIN_MIN = 30;

/** Posiciones lejanas dentro de la ventana que hacen falta para afirmar que no llegó. */
export const MIN_ABSENCE_POSITIONS = 3;

/** A quién atribuye el barrido de retiro no realizado la cancelación del envío (`shipment_events.attribution`). */
export type PickupMissedAttribution = "carrier" | "none";
