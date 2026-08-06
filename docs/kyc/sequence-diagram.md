# MOVO-72 — Diagrama de secuencia: integración con Didit.me

Flujo completo de verificación KYC de identidad: creación de sesión y resolución
asincrónica vía webhook. Sirve como contrato visual de diseño (Paso 0 del plan de
MOVO-72) — se ajusta si algo cambia durante la implementación.

**Actualizado en la revisión de PR #51 (tmvergara)**: `POST /kyc/session` y
`GET /kyc/status` pasaron de públicas (`userId` explícito) a protegidas — desde que
`POST /auth/register` emite tokens de sesión (mismo cambio), el `userId` se deriva del
JWT (header `x-user-id` que inyecta el gateway, ADR-010), no de un parámetro que
cualquiera podía adivinar. MOVO-94 queda resuelto por este cambio, no solo mitigado.

## Creación de sesión (`POST /kyc/session`)

```mermaid
sequenceDiagram
    actor Mobile
    participant GW as Gateway
    participant SU as svc-users (kyc.service)
    participant DB as Postgres (users schema)
    participant Didit as Didit.me

    Mobile->>GW: POST /api/v1/kyc/session<br/>Authorization: Bearer accessToken
    GW->>GW: authenticate (JWT) + inyecta x-user-id
    GW->>SU: POST /kyc/session (x-user-id: userId)

    SU->>DB: findById(userId)
    DB-->>SU: user { phoneVerified, kycStatusIdentity }

    alt phoneVerified = false
        SU-->>GW: 409 KYC_SESSION_NOT_ALLOWED
        GW-->>Mobile: 409
    else kycStatusIdentity no está en {not_started, rejected, manual_review}
        SU-->>GW: 409 KYC_SESSION_NOT_ALLOWED
        GW-->>Mobile: 409
    else validación OK
        SU->>Didit: POST /v3/session/ { workflow_id, vendor_data: userId, callback }
        Didit-->>SU: 201 { session_id, session_token, url }

        SU->>DB: begin transaction
        SU->>DB: kyc_verification.create({ userId, verificationType: identity,<br/>provider: "didit", externalSessionId: session_id, status: pending })
        SU->>DB: users.update kyc_status_identity = pending
        SU->>DB: commit
        Note over SU: log estructurado (AC11): kyc_session_created

        SU-->>GW: 201 { sessionId, sessionToken }
        GW-->>Mobile: 201 { sessionId, sessionToken }
        Mobile->>Mobile: SDK nativo de Didit abre la sesión (sessionToken)
    end
```

## Resolución vía webhook (`POST /kyc/webhook`)

```mermaid
sequenceDiagram
    participant Didit as Didit.me
    participant GW as Gateway
    participant SU as svc-users (kyc.service)
    participant DB as Postgres (users schema)
    actor Mobile

    Didit->>GW: POST /api/v1/kyc/webhook<br/>(body + X-Signature-V2 + X-Timestamp)
    GW->>SU: POST /kyc/webhook (raw body preservado)

    SU->>SU: verifyDiditSignature(rawBody, X-Signature-V2, X-Timestamp)
    alt firma inválida o timestamp fuera de ventana (>300s)
        SU-->>GW: 401 KYC_WEBHOOK_INVALID_SIGNATURE
        GW-->>Didit: 401
    else firma válida
        SU->>SU: mapDiditStatusToKycStatus(status)
        alt estado no terminal (Not Started/In Progress/Awaiting User/Resubmitted)
            SU->>SU: log (ignorado, no terminal)
            SU-->>GW: 200
            GW-->>Didit: 200
        else estado terminal (Approved/Declined/In Review)
            SU->>DB: findByExternalSessionId(session_id)
            alt sesión desconocida
                SU->>SU: log warning (session_id desconocido)
                SU-->>GW: 200
                GW-->>Didit: 200
            else sesión conocida
                SU->>DB: begin transaction
                SU->>DB: kyc_verification.resolveByExternalSessionId({<br/>externalSessionId, fromStatus: pending, toStatus, rawDecision })
                alt count = 0 (webhook duplicado / fuera de orden)
                    SU->>DB: rollback (no-op)
                    Note over SU: log info: webhook ignorado (AC7 idempotencia)
                    SU-->>GW: 200
                    GW-->>Didit: 200
                else count = 1 (transición aplicada)
                    SU->>DB: users.update kyc_status_identity = toStatus
                    SU->>DB: commit
                    Note over SU: log estructurado completo (AC6/AC11):<br/>previousStatus, newStatus, sessionId, reason
                    SU-->>GW: 200
                    GW-->>Didit: 200
                end
            end
        end
    end

    loop polling
        Mobile->>GW: GET /api/v1/kyc/status<br/>Authorization: Bearer accessToken
        GW->>GW: authenticate (JWT) + inyecta x-user-id
        GW->>SU: GET /kyc/status (x-user-id: userId)
        SU->>DB: findById(userId) — lee kyc_status_identity (caché)
        DB-->>SU: user
        SU-->>GW: 200 { status, manualReviewReason? }
        GW-->>Mobile: 200
    end
```
