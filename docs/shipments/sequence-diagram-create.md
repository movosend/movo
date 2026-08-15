# MOVO-80 — Diagrama de secuencia: creación de envío

Flujo de `POST /api/v1/shipments`, incluyendo la llamada síncrona `svc-shipments` →
`svc-users` para validar al receptor (comunicación REST síncrona sin message broker,
ADR-001/ADR-005). Sirve como contrato visual del acoplamiento entre servicios — se
ajusta si algo cambia durante la implementación.

```mermaid
sequenceDiagram
    actor Mobile
    participant GW as Gateway
    participant SS as svc-shipments (shipments.service)
    participant SU as svc-users (GET /users/:id)
    participant DB as Postgres (shipments schema)

    Mobile->>GW: POST /api/v1/shipments<br/>Authorization: Bearer accessToken
    GW->>GW: authenticate (JWT) + inyecta x-user-id (limpia cualquier<br/>x-user-* que haya mandado el cliente, ADR-010)
    GW->>SS: POST /shipments (x-user-id: senderId)

    SS->>SS: valida schema (AJV): packageType, dimensiones, receiverId,<br/>direcciones+coordenadas, pickupDate, franja horaria

    alt senderId === receiverId
        SS-->>GW: 422 SHIPMENT_RECEIVER_IS_SENDER
        GW-->>Mobile: 422
    else franja de retiro inválida (fin no posterior al inicio)
        SS-->>GW: 422 SHIPMENT_PICKUP_WINDOW_INVALID
        GW-->>Mobile: 422
    else franja de retiro en el pasado
        SS-->>GW: 422 SHIPMENT_PICKUP_WINDOW_IN_PAST
        GW-->>Mobile: 422
    else validación local OK
        SS->>SU: GET /users/{receiverId}<br/>x-user-id: senderId, timeout 5s
        alt svc-users no responde / timeout
            SU--xSS: (sin respuesta)
            SS-->>GW: 502 USERS_SERVICE_UNAVAILABLE
            GW-->>Mobile: 502
        else 404 (receptor no existe)
            SU-->>SS: 404
            SS-->>GW: 404 USER_NOT_FOUND
            GW-->>Mobile: 404
        else 200, isVerified = false
            SU-->>SS: 200 { isVerified: false, ... }
            SS-->>GW: 422 SHIPMENT_RECEIVER_KYC_NOT_APPROVED
            GW-->>Mobile: 422
        else 200, isVerified = true
            SU-->>SS: 200 { isVerified: true, ... }
            SS->>SS: computePlaceholderPrice(weightKg, distancia haversine)<br/>(placeholder temporal, EP-05/svc-pricing-logistics todavía no existe)
            SS->>DB: begin transaction
            SS->>DB: shipments.create({ ..., status: awaiting_receiver_confirmation })
            SS->>DB: shipment_events.create({ fromStatus: null,<br/>toStatus: awaiting_receiver_confirmation, actorId: senderId })
            SS->>DB: commit
            SS-->>GW: 201 { shipment }
            GW-->>Mobile: 201 { shipment }
        end
    end
```

## Notas de diseño

- El `senderId` sale siempre del header `x-user-id` inyectado por el gateway — nunca
  del body (AC10). El schema de `POST /shipments` rechaza (`additionalProperties:
  false`) cualquier `senderId` que el cliente intente mandar, en vez de ignorarlo en
  silencio.
- El timeout de 5s en la llamada a `svc-users` (`src/adapters/users-client.ts`) es la
  contrapartida obligatoria de que sea una llamada síncrona: sin él, una demora en
  `svc-users` cuelga el request de creación de envío indefinidamente — el modo de
  falla clásico de los microservicios síncronos. Este acoplamiento (`svc-shipments`
  depende de la disponibilidad de `svc-users` para poder crear un envío) es un
  trade-off aceptado de la arquitectura REST síncrona sin broker (ADR-001), documentado
  acá para el paper.
- `GET /users/:id` ya devuelve `isVerified: boolean`, definido exactamente como
  `kycStatusIdentity === APPROVED` del lado de `svc-users` — no hace falta un segundo
  campo ni una segunda llamada para chequear el KYC del receptor.
