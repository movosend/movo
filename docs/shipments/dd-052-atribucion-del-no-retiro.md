# DD-052 — Atribución del no-retiro con evidencia GPS pasiva

**Estado:** aceptado (MOVO-270). Borrador para pegar en
`[Movo] 011-Registro de Decisiones de Diseño` en Drive. Complementa DD-023/ADR-020 (traza GPS), DD-032 (barrido de
retiro no realizado, decisión D2), DD-045 (disputa automática) y DD-047 (penalidades) sin
modificarlos.

## Contexto

El barrido de retiro no realizado de DD-032 cancela **sin culpables** los envíos con
transportista cuya ventana de retiro cerró hace más de 24 h: el sistema no sabía quién faltó.
Eso dejó dos huecos:

- **Al transportista le conviene no aparecer antes que bajarse.** Si se baja con menos de 12 h
  paga el 25 % del precio acordado (DD-047, MOVO-310); si no aparece, el barrido cancela sin
  cobrarle nada.
- **El emisor que no entrega el paquete no paga.** Si cancela con la ventana cerrada es sin
  cargo, aunque el transportista haya ido hasta la puerta.

Además, `position-service#ingest` guardaba traza de envíos `assigned` (antes de la custodia),
contra la decisión de MOVO-271: la traza solo se guarda del handshake de retiro al de entrega.

## Decisión

1. **Evidencia pasiva**, sin botón "Llegué": se reusan las posiciones que el transportista ya
   reporta con el viaje activo. Por cada tramo de 45 s con claim de cadencia (incluidas las
   posiciones viejas de la cola offline), cada envío `assigned` del viaje clasifica la posición
   contra su punto de retiro y la suma a `shipments.pickup_evidence` (una fila por envío, sin
   traza):
   - **llegada**: `distancia − accuracyM ≤ 250 m` (se guarda una sola vez, la primera, con hora
     del dispositivo, lat/lng y precisión);
   - **lejos**: `distancia − accuracyM > 2 km`;
   - **zona gris**: cualquier lectura intermedia.

   Solo cuentan posiciones con `accuracyM ≤ 100 m`, no simuladas, y capturadas entre 30 min
   antes del inicio de la ventana acordada y su fin.
2. **Atribución en el barrido** (`attributePickupMiss`, solo para `assigned`):
   - **No llegó**: el viaje nunca pasó a `active` antes del cierre de la ventana (sigue
     `declared`, se canceló o venció, o `trips.started_at` es posterior), o hubo al menos
     **3** posiciones lejanas y **ninguna** en zona gris. Se cancela con
     `attribution: carrier` y se le registra la penalidad de baja de DD-047 (25 %) como deuda,
     con el mismo camino que MOVO-310 (`pending` en la oferta en la misma transacción,
     idempotente por `withdrawal_penalty:<offerId>`).
   - **Llegó y no hubo handshake**: `assigned → disputed` (arista nueva), sin cobro automático.
   - **Sin evidencia** (cualquier otro caso): se cancela sin culpables, como antes
     (`attribution: none`).

   `assignment_pending`/`assigned_unfunded` nunca se atribuyen: sin hold confirmado el retiro
   era imposible.
3. **La disputa de un no-retiro con llegada no bloquea al transportista**: el requisito
   `no_open_dispute` de DD-045 pasa a contar solo las disputas en las que tuvo la custodia
   (entraron desde `in_transit`/`delivered`). Es el que fue a la puerta.
4. **El hold se libera antes de pasar a disputa**, igual que antes de cancelar: `disputed` no
   tiene salida hasta MOVO-34, y no queda plata del emisor retenida en un estado sin salida. Si
   la liberación no se confirma, el envío no se toca y se reintenta en la próxima corrida. Si la
   resolución termina dándole la razón al transportista, se lo compensa por la cuenta corriente
   (DD-044), como ya asume DD-045 para el hold vencido.
5. **Cancelación del emisor con la ventana cerrada** (`computeCancellationPenalty`): con llegada
   registrada deja de ser sin cargo y cobra el 25 % con el motivo nuevo `carrier_arrived`.
6. **Pasado el plazo del barrido** (ventana + 24 h) **el retiro ya no se puede confirmar**
   (`HANDSHAKE_PICKUP_DEADLINE_PASSED`, en `/generate` y otra vez justo antes del commit de
   `/confirm`). Sin ese corte, un handshake tardío que confirma entre la liberación del hold y la
   transición del barrido dejaba un `in_transit` sin fondos para pagarle al transportista.
7. **Traza solo con custodia**: una posición se acepta y difunde con el envío `assigned` o
   `in_transit` y el viaje activo (`TRACKABLE_SHIPMENT_STATUSES`, separado ahora de
   `TRIP_EXECUTABLE_SHIPMENT_STATUSES`), pero se guarda en `carrier_positions` solo si el viaje
   tiene algún envío `in_transit`, asociada a uno de ellos. La lectura para disputas
   (`listCustodyTrace`) va por `trip_id` + el rango de custodia del envío, no por el
   `shipmentId` de la fila, y la purga de DD-023 pasa a ser por viaje: no borra filas de un
   viaje mientras otro envío del mismo viaje siga reteniendo la traza.
8. **Posiciones simuladas** (`mocked` de expo-location, solo Android): se aceptan y difunden,
   se guardan con la marca si hay custodia, y no cuentan como evidencia para nada.
9. **Reputación**: sin penalización automática (decisión del equipo, como MOVO-307). En el caso
   "no llegó", la push al emisor lo invita a calificar al transportista detrás de
   `PICKUP_NO_SHOW_RATING_INVITE_ENABLED`, apagado hasta que MOVO-337 habilite calificar envíos
   no entregados. El evento de cancelación guarda la atribución para esa regla.

## Por qué umbrales asimétricos

Equivocarse cuesta distinto según el lado:

- un falso **"no llegó"** le cobra al transportista el 25 % del precio;
- un falso **"llegó"** no cobra nada solo: lleva el envío a una disputa (o, si el emisor cancela
  con la ventana cerrada, le cobra el 25 % que ya pagaría con la ventana abierta).

Por eso la ausencia es mucho más difícil de probar que la llegada:

- **La falta de posiciones no prueba que el transportista no llegó.** Mala señal, un celular
  apagado o posiciones poco precisas caen en "sin evidencia", nunca en "no llegó".
- **Zona gris de 250 m a 2 km.** El pin de la dirección puede estar corrido cientos de metros
  (geocoding en barrios cerrados, edificios con entrada por otra calle, zonas rurales) y el GPS
  puede rebotar entre edificios informando una precisión optimista. Una sola posición en ese
  rango alcanza para no penalizar. 2 km es el mismo radio del aviso "está por llegar"
  (MOVO-240).
- **La precisión informada siempre juega a favor del transportista**: se resta tanto para la
  llegada como para la ausencia.
- **250 m de llegada** (el ticket proponía 150 m): los 100 m del handshake más margen por el
  geocoding y por estacionar a una cuadra. Con la resta de la precisión, una lectura informada a
  ~350 m con ±100 m todavía cuenta.
- **3 posiciones lejanas** son, con la cadencia de 45 s, más de 2 minutos de lecturas precisas
  y consistentes en otro lugar durante la ventana.
- **El margen de 30 min antes de la ventana** evita que pasar por la puerta horas antes
  "gaste" la única llegada y arrastre al emisor a una disputa.

**La evidencia del transportista no alcanza para culpar al emisor**: el celular del emisor no se
trackea, así que "el transportista estuvo ahí" no prueba que el emisor faltó. Por eso ese caso va
a disputa y no a un cobro automático.

## Alternativas descartadas

- **Botón "Llegué"**: depende de que el transportista se acuerde, y es justo la evidencia que
  más le conviene fabricar.
- **Penalizar por falta de posiciones**: castiga al que tenía mala señal en la puerta.
- **Cobrarle al emisor cuando el transportista llegó**: el emisor no se trackea; se resuelve en
  la disputa.
- **Guardar la traza previa al retiro para decidir después**: contradice MOVO-271 (no se guarda
  ubicación sin custodia). La evidencia agregada alcanza.
- **Conservar el hold en la disputa para la matriz de MOVO-337**: la disputa no tiene salida hoy
  y el hold vence solo a los 5 días (DD-050); se prefirió no dejar fondos retenidos sin envío.
- **Subir la precisión del GPS cerca del retiro** (`Accuracy.High` con un `assigned` a menos de
  2 km): mejoraría la evidencia, pero toca la medición de batería de MOVO-242. Queda como mejora;
  con los umbrales asimétricos, una mala señal solo hace perder evidencia, nunca penaliza.

## Limitaciones aceptadas

- **iOS no informa `mocked`**: una ubicación simulada en iOS cuenta como real.
- **El background usa `Accuracy.Balanced`**: muchas lecturas quedan por encima de 100 m y se
  descartan, así que más casos terminan "sin evidencia".
- **El geocoding de la dirección** puede dejar el pin lejos de la puerta real; la zona gris
  evita penalizar, pero un transportista que llegó puede quedar "sin evidencia".
- **El emisor no se trackea**: no hay forma de probar que el emisor faltó.
- **La penalidad del no-retiro es plata para Movo**, sin crédito al emisor (misma limitación que
  DD-044 para las penalidades cobradas como deuda).
- **`disputed` sigue sin salida hasta MOVO-34**: la disputa de un no-retiro queda abierta, bloquea
  la baja de cuenta de las partes (como DD-045) y no tiene hold que capturar. MOVO-334 tiene que
  sumar un motivo de sistema para estas disputas y MOVO-337 contemplar envíos `assigned` en su
  matriz.
- **La purga del historial vencido (MOVO-230)** borra un envío con su traza por cascade: si un
  envío del viaje sigue en disputa cuando otro alcanza esa retención (mucho más larga que la de
  DD-023), la evidencia compartida se pierde.
- **Carrera residual de milisegundos** entre el chequeo del plazo en `/confirm` y el commit del
  handshake, justo en el instante del vencimiento.

**Referencias**: MOVO-270 (este ticket), MOVO-258/DD-032 (barrido), MOVO-271 (traza solo con
custodia), MOVO-240 (aviso de proximidad), MOVO-251 (tracking por viaje), DD-023/ADR-020 (traza y
última posición), DD-045 (disputa automática y bloqueo), DD-047/MOVO-307/310 (penalidades),
DD-044 (cuenta corriente), MOVO-334/337 (disputas), MOVO-242 (emisión en background).
