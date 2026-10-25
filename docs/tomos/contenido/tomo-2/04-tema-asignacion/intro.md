# Descripción del Tema

**EP-03 · Asignación y Negociación** es el mercado de Movo: sobre un envío publicado, los transportistas verificados proponen cuánto quieren cobrar, el emisor compara las ofertas por precio o por reputación y elige una, y el sistema asigna el envío de forma atómica. A diferencia de un precio fijo, el emisor conserva el control de la elección, y el transportista conoce en todo momento su posición frente a la competencia.

La oferta es una entidad propia con una máquina de estados de seis valores. Aceptarla no cobra: deja el envío en `assignment_pending` o `assigned_unfunded` según la **saga de asignación** (DD-037), que se completa en el tema *Pagos y Economía* con la reserva de fondos. Una asignación concurrente se resuelve con bloqueo optimista: solo una aceptación puede ganar.

**Servicios involucrados:** `gateway`, `movo-svc-shipments` (ofertas, viajes y asignación), `movo-svc-users` (reputación y bloqueos), `movo-svc-payments` (cuenta de cobro del transportista) y `movo-mobile`.
