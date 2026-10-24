# ADR-055 — Cambio forzado de estado de un envío desde el panel

**Estado:** propuesto (MOVO-330 + MOVO-331, sub-issues de MOVO-329). Borrador para pegar en la
sección de ADRs de `[Movo] 004 - Sprint 0.md` en Drive. Pendiente de la revisión de dos
integrantes y de coordinar con MOVO-34, porque ambos tocan la salida de `disputed`. Complementa
ADR-021 (los 11 estados), ADR-035 (cobro), ADR-044 (cuenta corriente), ADR-045, ADR-047, ADR-054 y
la decisión 6 de MOVO-286 (toda escritura del panel pasa por `svc-admin`) sin modificarlos.

## Contexto

Un envío puede quedar trabado: un hold inconsistente con el estado, un transportista que no
responde, un envío que espera un pago que ya se acreditó. Hoy el único recurso es tocar la base a
mano, sin bitácora ni efectos sobre el hold. El panel (`movo-admin`) necesita una acción para
corregirlo, y es la de más riesgo: mueve plata, custodia y reputación.

## Decisión

1. **El backend decide, no el panel.** La matriz de abajo es una constante de `@movo/shared`
   (`FORCED_TRANSITION_MATRIX`); `svc-shipments` valida cada pedido contra ella y el panel solo la
   lee para decidir qué ofrecer. Un par que no está en la matriz es `422 TRANSITION_NOT_ALLOWED`,
   con el motivo en `details.reason` (`blockedTransitionReason`).
2. **Nunca un `UPDATE` directo del estado.** Cada celda ejecuta el servicio de dominio que ya usa
   la transición normal, con sus efectos (hold, ofertas, ventana de retiro, tracking y chat, que se
   derivan del estado). Un par sin servicio definido queda bloqueado.
3. **Solo aristas que ya existen en la máquina de estados.** `manual` es una transición normal
   ejecutada por un admin; `forced` es una arista normal que el admin ejecuta con un efecto
   distinto del camino normal. Hoy la única diferencia es que **se condona la penalidad**.

### Matriz

| Origen | Destino | Tipo | Servicio de dominio | Riesgo | Efectos |
| --- | --- | --- | --- | --- | --- |
| `awaiting_receiver_confirmation` | `cancelled` | manual | `cancelShipment` | medio | sin hold ni ofertas |
| `published` | `cancelled` | manual | `cancelShipment` | medio | las ofertas pasan a `shipment_cancelled` |
| `rejected_by_receiver` | `cancelled` | manual | `cancelShipment` | medio | idem |
| `assignment_pending` | `published` | forced | `withdrawCarrierFromShipment` | medio | libera el hold, desasigna, restaura la ventana original |
| `assignment_pending` | `assigned` | manual | `confirmAssignmentByAdmin` | alto | **exige hold autorizado** (consulta con `sync` a payments) |
| `assignment_pending` | `cancelled` | manual | `cancelShipment` | alto | libera el hold si existe |
| `assigned_unfunded` | `published` | forced | `withdrawCarrierFromShipment` | medio | idem |
| `assigned_unfunded` | `assigned` | manual | `confirmAssignmentByAdmin` | alto | exige hold autorizado |
| `assigned_unfunded` | `cancelled` | manual | `cancelShipment` | alto | libera el hold si existe |
| `assigned` | `published` | forced | `withdrawCarrierFromShipment` | alto | libera el hold, desasigna, **sin penalidad al transportista** |
| `assigned` | `cancelled` | forced | `cancelShipment` | alto | libera el hold **antes** de cancelar, **sin penalidad al emisor** |
| `delivered` | `completed` | manual | `captureAndComplete` | crítico | captura el hold y acredita al transportista |

**Bloqueadas (todo lo que no figura arriba), con su razón:**

- `disputed → *`: la salida es la resolución de la disputa (MOVO-34), que decide el estado final y
  mueve la plata. **Entrar a `disputed` tampoco se fuerza**: una disputa nace con su expediente
  (`shipments.disputes`, ADR-054) y lo abre una parte o un barrido.
- `completed → *`: el pago ya se repartió; se corrige desde Pagos. La única salida del grafo
  (`completed → disputed`) es de las partes.
- `cancelled → *`: terminal por diseño (MOVO-79). No se reabre.
- `in_transit → *` y `* → in_transit` / `* → delivered`: el retiro y la entrega se confirman con el
  handshake criptográfico (ADR-020). Forzarlos sin esa evidencia rompe la garantía de custodia, y la
  captura del pago depende de ella. Si hace falta, será una decisión propia con su evidencia.
- `assigned → assigned_unfunded`: refleja un hecho de Mercado Pago (hold vencido o cancelado), que
  entra por el webhook; el admin no lo declara.
- `awaiting_receiver_confirmation → published|rejected_by_receiver` y
  `rejected_by_receiver → awaiting_receiver_confirmation`: son decisiones del receptor y del emisor.

### Fricción por riesgo

El riesgo es el del **destino** de la celda (columna "Riesgo"). Lo exige `svc-admin` (MOVO-332), no
este servicio:

| Riesgo | Motivo (≥ 20 caracteres) | Código del envío tipeado | OTP nuevo por acción |
| --- | --- | --- | --- |
| medio | sí | no | solo si es `forced` |
| alto | sí | sí | solo si es `forced` |
| crítico | sí | sí | sí |

### Efectos fijos de todo cambio forzado

- **No penaliza a nadie ni genera deuda** (ADR-047, ADR-044): la cancelación y la baja que ejecuta un
  admin condonan la penalidad.
- **No toca la reputación.** `disputed` es lo único que saca un envío de ella, y no se fuerza.
- **Un hecho externo se verifica, no se confía en el motivo del admin.** Para `assigned`, el hold
  tiene que estar `authorized` o `captured` en payments; si no, `422 HOLD_NOT_AUTHORIZED`.
- Desde `assigned`, el hold se libera **antes** de cancelar (ya está autorizado: no hay un pago
  concurrente que pueda llegar). Si payments falla, el envío queda como estaba.

### Avisos a las partes

Push al emisor, al receptor y al transportista (el que tenía **antes** del cambio, porque la baja lo
desasigna), categoría `shipments`, **sin motivo ni montos** (criterio de MOVO-210):

- Emisor: "Soporte actualizó el estado de tu envío" / "El equipo de Movo cambió el estado de tu envío. Tocá para ver el detalle".
- Receptor y transportista: "Soporte actualizó el estado de un envío" / "El equipo de Movo cambió el estado del envío que recibís|de un envío que llevás. Tocá para ver el detalle".

**Se mandan como críticas (`ignorePreferences`)**: saltan el toggle de categoría y el horario de
silencio, como las sanciones de cuenta (MOVO-296). Decisión a confirmar en la revisión: si el equipo
prefiere respetar las preferencias, es sacar el flag de `force-status.service.ts#notifyParties`.
El evento queda igual en la línea de tiempo de la app.

### Registro

El evento se agrega a `shipments.shipment_events` (append-only, inmutable) con dos columnas nuevas:
`kind` (`normal` | `manual` | `forced`) y `actorName` (snapshot del nombre del admin); `actorId` es el
id del admin y `reason` el motivo. `GET /shipments/:id/events` (las partes) devuelve `kind` pero
**`actorId` y `reason` en `null`** si lo hizo un admin: ven que fue soporte y el cambio de estado,
nunca quién ni por qué. `GET /internal/admin/shipments/:id/events` (el panel) lo devuelve completo.

### Segundo factor por acción (step-up)

Lo implementa `svc-admin`/`svc-users` en MOVO-332; este servicio no lo valida. Propuesta: un OTP
nuevo por acción, distinto del OTP de la jornada de MOVO-286, de **un solo uso**, con **vida de 5
minutos** y **atado a la acción** (`shipmentId` + `targetStatus`), de modo que no sirve para otro
envío ni para otro destino.

### Concurrencia e idempotencia

`POST /internal/admin/shipments/:id/force-status` con `{ targetStatus, expectedStatus, reason,
adminId, adminName, idempotencyKey }`. Solo red Docker interna (ADR-010): no está en el
`routes-map` del gateway.

- **`expectedStatus` obligatorio.** Si el estado actual es otro: `409 STATUS_CHANGED` con
  `details.currentStatus`. Los servicios de dominio agregan su propio compare-and-swap
  (`expectedFrom`), que cierra la ventana entre la lectura y el `UPDATE`.
- **Lock por envío** en Redis (`force-status:lock:<id>`, 60 s): dos cambios simultáneos no se pisan;
  el segundo recibe `409` (`FORCE_STATUS_IN_PROGRESS` o `STATUS_CHANGED`).
- **Idempotencia** por `idempotencyKey` (24 h): repetirla devuelve el resultado original con
  `replayed: true`, sin efectos ni avisos nuevos. La misma clave para otro envío o destino es
  `409 IDEMPOTENCY_KEY_REUSED`; otra clave con el estado ya cambiado, `409 STATUS_CHANGED`.
- **Falla de un efecto externo** (liberar o capturar el hold): `502 FORCE_STATUS_EFFECT_FAILED`, el
  envío queda en su estado original, se loguea `force_status_failed` y se alerta al equipo
  (`AlertNotifier`). La clave no se consume: se puede reintentar.

## Alternativas descartadas

- **Permitir cualquier transición** (lo que hace el prototipo): sin un servicio de dominio detrás,
  un cambio de estado deja el hold, las ofertas y el chat inconsistentes con el estado.
- **`UPDATE` directo del estado:** es el problema que se quiere dejar de tener.
- **Forzar `in_transit` / `delivered` con una foto o un motivo:** reemplaza la evidencia criptográfica
  de custodia por la palabra de un admin y dispara la captura del dinero.
- **Que el panel valide la matriz:** el panel es ayuda visual; la fuente de verdad es el backend.
- **Un `FOR UPDATE` de Postgres que abarque todo el cambio:** los servicios de dominio abren sus
  propias transacciones y llaman a payments en el medio; un lock de fila que cruce esas llamadas
  dejaría una transacción abierta contra un servicio externo.

## Consecuencias

- Hoy no hay ninguna salida para un envío `in_transit` trabado ni para uno `disputed`: lo primero
  necesita una decisión sobre evidencia, lo segundo es MOVO-34.
- Una baja forzada (`withdrawCarrierFromShipment`) persiste el claim del retiro antes de llamar a
  payments; si payments falla, el envío conserva su estado pero queda con la baja pendiente que
  retoma el barrido (MOVO-310). Si la retoma el barrido, el evento queda como `normal`.
- Que los avisos sean críticos es una decisión de producto abierta a la revisión del equipo.
- Pendiente fuera de alcance: deshacer un cambio, cambios masivos, editar otros datos del envío.
