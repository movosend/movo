# ADR-042 — Viajes recurrentes: recurrencia como atributo del `Trip` con generación de la siguiente ocurrencia

**Estado:** aceptado (MOVO-264, spike). Borrador para pegar en la sección de ADRs de
`[Movo] 004 - Sprint 0.md` en Drive. Implementación en MOVO-265 (`svc-shipments`) y
MOVO-266 (`movo-mobile`). El ticket reservaba ADR-029 (lo tomó MOVO-260) y después
ADR-041 (lo tomó MOVO-276), así que queda 042.

## Contexto

El PO pide viajes recurrentes ("todos los viernes viajo a Villa María"). Hoy un `Trip`
es un viaje con una fecha concreta, y varias piezas dependen de eso: las ofertas
aceptadas, el filtro de matching por día de `departureAt` (MOVO-163), el barrido de
vencimiento (MOVO-238/ADR-032), el cierre a `completed` y el índice de un solo viaje
`active` por transportista. Por eso un `Trip` no puede representar "todos los
viernes" en una sola fila.

## Alternativa descartada

**Entidad `TripSchedule` + job que materializa trips con N días de anticipación.**
Cubre más casos (por ejemplo, matchear paquetes de dentro de dos semanas), pero suma una
entidad, un job nuevo y el problema de "editar la serie o solo esta ocurrencia". Para el
alcance del TFG no compensa.

## Decisión

1. **Un trip por ocurrencia, generados de a uno.** La recurrencia es un atributo del
   propio `Trip`: `recurrenceWeekdays` (`int[]`, valores 0-6, nullable = no recurrente),
   `recurrenceUntil` (`date`, nullable, inclusive, interpretada en
   `America/Argentina/Cordoba`) y `seriesId` (`uuid`; el primer trip de la serie usa su
   propio id). Cuando pasa el `departureAt` del trip vigente, el sistema genera **solo la
   ocurrencia siguiente** como un `Trip` común en `declared`. La genera sin importar cómo
   termine el vigente (`declared` todavía sin vencer, `active`, `expired`, `cancelled`,
   `completed`).
2. **Convención de días:** `0 = domingo … 6 = sábado`, como `getDay()` de JS y
   `EXTRACT(DOW)` de Postgres. Se fija como constante documentada en `@movo/shared`. El
   mobile ordena los chips arrancando en lunes, pero el mapeo nunca depende de la
   posición.
3. **Trip vigente e idempotencia por sucesor.** El trip generado guarda
   `generatedFromTripId` (`uuid`, FK a `Trip`, **UNIQUE**): cada trip tiene a lo sumo un
   sucesor. El "trip vigente" de una serie es el que nadie referencia. Se descartó el
   índice único parcial "un solo trip no terminal por `seriesId`": cuando el vigente pasa
   a `active` y se genera el siguiente en `declared`, los dos son legítimos a la vez. El
   insert usa `ON CONFLICT DO NOTHING`, así que una segunda corrida del barrido o dos
   instancias en paralelo no duplican, y no hace falta un `nextGeneratedAt`. La API
   expone `isSeriesHead` para que el mobile no tenga que reconstruir la cadena.
4. **Cuándo y dónde se genera.** Es un paso nuevo del barrido existente
   (`trip-expiry-sweep.ts`, `runStep` propio), sin job nuevo. Corre **después** de
   `cancel_overdue_declared`, así el vigente que vence en esa misma corrida ya cuenta
   como `expired` para la regla de serie fantasma (punto 8).
5. **Fecha de la siguiente ocurrencia.** Es el próximo día de `recurrenceWeekdays`
   **estrictamente posterior a `max(departureAt, now)`**, a la misma hora de pared,
   calculado en `America/Argentina/Cordoba` con el helper de
   `@movo/shared/utils/argentina-date` (el mismo huso que `canStartTripOn`, ADR-034).
   Nunca se suman 7×24 h en UTC. Tomar el máximo con `now` evita una cascada de trips
   que nacen vencidos si el barrido estuvo caído varios días. Si la fecha supera
   `recurrenceUntil`, no se genera nada y la serie termina sola. El trip generado copia
   ruta, `vehicleType`, la recurrencia y `seriesId`.
6. **Editar.** La recurrencia solo se edita en el trip vigente (en otro trip de la serie
   responde 409 `TRIP_NOT_SERIES_HEAD`). Editar el vigente (ruta, hora, días) define el
   patrón de las ocurrencias siguientes: no hay una edición "de la serie" aparte. Un viaje
   con paquetes aceptados no se edita (409 `TRIP_HAS_ACCEPTED_PACKAGES`), tampoco su
   recurrencia: si el transportista quiere otro patrón, declara un viaje nuevo. La única
   excepción es **apagar** la recurrencia (`recurrenceWeekdays: null`, con o sin
   `recurrenceUntil: null`), que no cambia ese viaje concreto y es la única forma de cortar
   una serie cuyo vigente ya tiene paquetes (review de PR #246: la primera versión dejaba
   pasar cualquier `PATCH` de solo recurrencia, y entonces cambiar los días de un vigente
   ya `active` chocaba con la regla del día de salida de abajo, pensada para un viaje que
   todavía se puede editar). Validaciones: al menos un día, sin repetidos; el
   día de semana de `departureAt` (huso Córdoba) tiene que estar en `recurrenceWeekdays`;
   `recurrenceUntil` tiene que ser posterior a la fecha de `departureAt`. Un trip
   auto-creado por MOVO-234 se puede volver recurrente con `PATCH`, como cualquier otro.
7. **Cancelar la ocurrencia o cortar la serie.** `POST /trips/:id/cancel` (MOVO-260)
   suma `{ stopRecurrence?: boolean }`. Sin el flag cancela solo la ocurrencia, y la
   siguiente se genera igual cuando pasa su `departureAt`. Con `true` también apaga la
   recurrencia, en la misma transacción. Sobre un trip no recurrente o que no es vigente,
   el flag se ignora. El cancel sigue limitado a viajes `declared` sin paquetes aceptados
   (`TRIP_NOT_DECLARED`/`TRIP_HAS_ACCEPTED_PACKAGES`), así que la elección "solo este /
   este y dejar de repetir" del mobile solo aparece ahí. Para cortar una serie cuyo
   vigente ya tiene paquetes, está "Dejar de repetir" (el `PATCH` que la apaga, única
   excepción del punto 6). Apagar la
   recurrencia (`recurrenceWeekdays = null`) conserva `seriesId` como histórico.
8. **Cortes automáticos** (siempre `recurrenceWeekdays = null` en el vigente + push):
   - **Serie fantasma:** si las últimas 3 ocurrencias consecutivas de la cadena
     (`generatedFromTripId`) terminaron `expired`, no se genera la siguiente. Cuenta
     cualquier `expired`, sea un `declared` vencido o un `active` que se quedó sin
     paquetes: las dos rutas significan "el viaje no llevó nada" y no hay un `startedAt`
     que permita distinguirlas. Una `cancelled` por el usuario no cuenta y corta la
     racha.
   - **No se puede generar:** la cuenta está `banned`/`deleted` o tiene
     `bannedUntil > now` (`svc-users`), o el transportista no cumple los requisitos de
     ADR-036 (licencia aprobada y cuenta de MP, `resolveCarrierEligibility`). Generar es
     declarar un viaje en su nombre, así que se le exige lo mismo que a `POST /trips`.
     Como el único disparador es el `departureAt` del vigente, saltear una ocurrencia
     equivale a cortar la serie, así que se corta de forma explícita. Hoy
     `GET /internal/users/:id/kyc-status` no expone el estado de la cuenta (solo da 404
     si está `deleted`), así que MOVO-265 lo extiende con `accountStatus` y
     `bannedUntil`.
   - **Falla de infraestructura no es motivo de corte:** si `svc-users` o `svc-payments`
     no responden, la ocurrencia no se genera en esa corrida y la próxima reintenta. El
     punto 5 garantiza que la fecha no nazca vencida.
9. **Tope de 3 series activas por transportista** (serie activa = trip vigente con
   `recurrenceWeekdays` no nulo). Prender la recurrencia con 3 ya activas responde 409
   `RECURRING_SERIES_LIMIT`. Cambiar los días de una serie ya activa no cuenta como
   nueva.
10. **Avisos.** Push al generar ("Declaramos tu viaje del {día} a {destino}") y al
    cortar automáticamente ("Dejamos de repetir tu viaje a {destino} porque no saliste
    en tus últimos 3 viajes" o un motivo genérico, sin detalles de moderación). Respetan
    las preferencias de MOVO-239 (categoría nueva en `notification-categories.ts`). En
    "Mis viajes", el banner de viaje nuevo de MOVO-236 distingue las ocurrencias
    generadas por `generatedFromTripId`.
11. **Solapamiento: sin control.** Verificado en `develop` (14/10): `createTrip` no
    valida trips superpuestos de un mismo transportista. Solo valida los requisitos de
    ADR-036, que `departureAt` sea futura y que origen y destino estén a 100 m o más. La
    generación tampoco lo controla. Si algún día se agrega a `POST /trips`, la
    generación tiene que reusar esa misma validación.
12. **Auditoría:** mismo criterio que MOVO-238. Log estructurado por generación y por
    corte (`trip_recurrence_generated`, `trip_recurrence_stopped` con `reason`), sin
    tabla de eventos propia para `Trip`, y un resumen por corrida (`trip_recurrence_run`:
    generadas, cortadas, postergadas y ya generadas por otra corrida).

## Trade-offs aceptados

- **Visibilidad corta:** solo existe la próxima ocurrencia, así que no se matchean
  paquetes para dentro de dos semanas o más. Es el costo de no tener un `TripSchedule`.
- **La hora queda atada al vigente:** las ocurrencias futuras copian la hora del
  `departureAt` vigente. Si ese viaje tiene paquetes aceptados, ni la hora ni los días se
  pueden cambiar hasta que se genere la siguiente (o se declara un viaje nuevo); solo se
  puede apagar la serie.
- **Cortar en vez de saltear:** un problema temporal de requisitos (por ejemplo, una
  cuenta de MP desvinculada justo cuando corre el barrido) apaga la serie, y el
  transportista tiene que volver a prenderla. Se aceptó porque la alternativa (saltear
  y reintentar con fecha) necesita un disparador que no sea el `departureAt` del
  vigente, que es justamente lo que este modelo evita.
- **La racha de fantasma cuenta ocurrencias, no semanas:** con varios días por semana,
  tres vencidas seguidas pueden pasar en menos de una semana.

## Referencias

MOVO-264, MOVO-265, MOVO-266, MOVO-259, MOVO-163, MOVO-234, MOVO-236, MOVO-238, MOVO-239,
MOVO-260 (ADR-029), ADR-032 (MOVO-258), ADR-034 (MOVO-277), ADR-036 (MOVO-116).
