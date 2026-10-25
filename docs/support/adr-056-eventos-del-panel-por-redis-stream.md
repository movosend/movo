# ADR-056 — Eventos de la bandeja de soporte por Redis Stream (MOVO-322)

> Borrador para pegar en `[Movo] 004 - Sprint 0.md`. Complementa ADR-001 (microservicios con REST síncrono),
> ADR-022 (WebSocket nativo) y ADR-051 (soporte sobre el chat existente) sin modificarlos.

**Contexto.** La bandeja de soporte del panel (MOVO-323) necesita ver en tiempo real las consultas nuevas, los
mensajes de los usuarios y lo que hacen los otros agentes. Los cambios ocurren en `movo-svc-shipments`, dueño del
modelo y del `ChatHub` (ADR-051), pero el panel solo habla con `movo-svc-admin` (decisión 6 de MOVO-286), que es
donde va a vivir su WebSocket (el ticket de un solo uso del navegador) y su respaldo por polling
(`GET /admin/support/events?since=<cursor>`, con `reset` si el cursor ya no se guarda). Hace falta que
`svc-shipments` le haga llegar esos eventos a `svc-admin`, con un cursor monótono y unos minutos de retención. Hasta
acá toda la comunicación entre servicios es REST síncrono y no hay broker (ADR-001/005).

**Decisión.**

- **`svc-shipments` escribe cada evento en el Redis Stream `support:events`** (`XADD … MAXLEN ~ 2000`), en el mismo
  Redis 7 que ya comparten los servicios (ADR-003). Cuatro tipos (`SupportStreamEvent`, `@movo/shared`):
  `conversation_created`, `support_message` (incluidas notas y eventos del equipo), `conversation_updated` y
  `counts_changed`. Cada uno lleva la fila de la bandeja ya actualizada, **sin nombres**: `svc-shipments` solo tiene
  ids y los nombres los completa `svc-admin` con `svc-users`, como en el resto del panel.
- **`counts_changed` no lleva contadores**: `byOwner.mine` depende de quién mira, así que `svc-admin` los calcula
  por admin al presentar el evento (`counts_updated`).
- **El id de la entrada (`<ms>-<seq>`) es el cursor del panel.** Es monótono por construcción; `GET events` lee con
  `XRANGE (since +`. Si `since` es más viejo que la primera entrada que queda (el `MAXLEN` recortó), responde
  `reset: true` y el panel vuelve a pedir lista, contadores y mensajes.
- **Escribir el evento nunca falla la operación**: el cambio ya está guardado en Postgres; si Redis no responde se
  loguea y el panel lo ve al refrescar (por eso hay `reset` y por eso el panel refetchea al reconectar).
- **Lo escribe el lado del usuario y el del agente** (`modules/admin-support/support-admin-feed.ts`), así la bandeja
  ve igual una consulta abierta desde la app que una respuesta de otro agente.

**Alternativas descartadas.**
- *Tabla `support_events` en Postgres y `svc-admin` consultando cada 1-2 s por un endpoint interno*: sin
  infraestructura nueva y sin ADR, pero con latencia de polling entre servicios además del polling del panel, carga
  constante en la base y una purga más que mantener.
- *Redis Pub/Sub*: sin retención, así que `GET events?since` no tendría de dónde leer lo que pasó mientras el panel
  estaba desconectado.
- *Broker de mensajes (RabbitMQ, SQS)*: un contenedor o servicio administrado más para un solo caso de uso;
  desproporcionado para el TFG (ADR-006).
- *Que `svc-admin` se conecte por WebSocket a `svc-shipments`*: sin retención ni cursor, y otra conexión de larga
  vida que reconectar.

**Trade-offs aceptados.**
- **Primera comunicación asíncrona entre servicios** del proyecto: un contrato más (`SupportStreamEvent`) que no se
  ve en el Swagger. Se acota a este caso: no es una cola de trabajo, nadie depende de procesar cada entrada una
  vez y perderlas solo cuesta un refetch del panel.
- **Retención corta y aproximada** (`MAXLEN ~`): un panel desconectado mucho tiempo recibe `reset`.
- Redis pasa a ser camino de los eventos del panel además de sesiones y rate limiting: si cae, la bandeja deja de
  actualizarse sola, pero nada se pierde en Postgres.
