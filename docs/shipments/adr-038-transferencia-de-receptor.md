# ADR-038 — Transferencia de receptor como entidad paralela al ciclo de vida del envío

**Estado:** aceptado (MOVO-275). Borrador para pegar en la sección de ADRs de
`[Movo] 004 - Sprint 0.md` en Drive. Complementa ADR-027 (elegir otro receptor tras un
rechazo) sin modificarlo.

## Contexto

Una vez que el receptor aceptó un envío, y sobre todo con el paquete viajando, no había
forma de cambiar quién lo recibe. ADR-027 resuelve otro caso: el **emisor** elige otra
persona después de un **rechazo**, antes del retiro, volviendo el envío a
`awaiting_receiver_confirmation`. Acá lo inicia el **receptor**, sobre un envío que ya
aceptó, y puede pasar **en tránsito**.

## Decisión

1. **Entidad propia, no un estado del envío.** `shipments.receiver_transfer_requests`
   (`pending_new_receiver` → `completed`, con `rejected_by_new_receiver`, `expired` y
   `cancelled` como cierres alternativos). La transferencia corre en paralelo y nunca
   toca `Shipment.status`: con el paquete en tránsito, volver a esperar confirmación
   rompería el tracking (MOVO-251) y la máquina de estados. Al aceptar, en una sola
   transacción la solicitud pasa a `completed` y el envío cambia de `receiverId`
   (compare-and-swap contra el receptor que la pidió y un estado que todavía la admite).
2. **La persona invitada tiene que aceptar** y tener KYC aprobado, sin bloqueo con el
   emisor (ADR-026). No puede ser el receptor actual, el emisor ni el transportista.
3. **El emisor no aprueba.** Se evaluó exigir su aprobación (paga y eligió al receptor,
   y sería una defensa ante una cuenta de receptor comprometida). Se descartó por la
   fricción: si el emisor tarda, la transferencia llega tarde para quien no va a estar.
   Mitigación: KYC y aceptación de la persona invitada, push informativa al emisor en el
   momento y todo queda en la línea de tiempo como evidencia para una disputa (MOVO-30).
4. **El receptor original conserva acceso de solo lectura** (decisión del equipo,
   distinta de ADR-027, donde quien rechazó pierde el acceso). Sigue viendo el detalle,
   la línea de tiempo, las fotos y el tracking en vivo, y el envío sigue en su lista con
   el badge "Transferido". No tiene ninguna acción: no firma la entrega, no califica, no
   puede volver a transferir. Se implementa en `hasShipmentAccess` (lectura); los
   asserts de acción siguen mirando el `receiverId` vigente.
5. **Una sola transferencia efectiva por envío.** Solo la completada consume el cupo.
   A lo sumo una pendiente y una completada por envío, garantizado por índices únicos
   parciales.
6. **Plazo y carrera con la entrega.** La persona invitada tiene
   `RECEIVER_TRANSFER_TIMEOUT_HOURS` (6 h); la vence el mismo barrido que la
   confirmación del receptor (MOVO-130), y aceptar fuera de plazo da 409 aunque el
   barrido no haya corrido (pedir otra transferencia también vence inline la pendiente
   pasada de plazo). La entrega "empieza" cuando el transportista genera el QR de entrega
   por primera vez: eso deja una marca durable (`shipments.delivery_handshake_started_at`,
   no el QR de Redis, que vence a los 15 s), cancela la solicitud pendiente y desde ahí no
   se puede pedir ni aceptar un cambio; el UPDATE de `receiverId` también exige la marca
   vacía. El handshake siempre valida contra el `receiverId` vigente.
7. **Línea de tiempo: un item por solicitud.** `shipment_events` sigue siendo "evento =
   transición de estado". Las solicitudes se exponen aparte
   (`GET /shipments/:id/receiver-transfers`, sin cambiar la respuesta de `/events`) y el
   mobile las intercala por fecha como un solo item que cambia según su estado, con texto
   según quién mira. El emisor y quien pidió cada solicitud ven todas; el transportista y
   el receptor vigente, solo la completada.

## Trade-offs aceptados

- Sin aprobación del emisor, una cuenta de receptor comprometida puede desviar el envío
  hacia otra persona verificada. Queda la evidencia y la disputa.
- El receptor original sigue viendo la ubicación del transportista hasta la entrega
  aunque ya no reciba el paquete (decisión del equipo: le sirve saber que llegó a quien
  eligió).
- Dos llamadas a `svc-users` más al pedir y una al aceptar (perfil y bloqueos), fallando
  cerrado si no responde.
- Una solicitud pendiente cuenta como actividad de la persona invitada para la baja de
  cuenta (MOVO-134).

## Referencias

MOVO-275, ADR-027 (MOVO-253), ADR-026 (MOVO-175), ADR-023 (traza GPS), MOVO-130, MOVO-158.
