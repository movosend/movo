# ADR-036 — Requisitos habilitantes del transportista: licencia aprobada + cuenta de Mercado Pago vinculada

**Estado:** aceptado (MOVO-116). Borrador para pegar en la sección de ADRs de
`[Movo] 004 - Sprint 0.md` en Drive. Revierte, en ese punto, la decisión de MOVO-142
("la licencia de conducir es una insignia de confianza, no un permiso de acceso").

## Contexto

Hasta MOVO-116, operar como transportista (declarar un viaje, ofertar) solo exigía el rol
`carrier` y el KYC de identidad aprobado. MOVO-142 había decidido explícitamente no exigir
la licencia de conducir: alguien sin auto puede llevar un paquete en micro, tren o avión.

Dos problemas con eso:

- **Mercado Pago**: sin una cuenta vinculada y vigente (MOVO-111), el transportista no
  puede cobrar. Hoy lo descubre recién el hold (MOVO-209, 409
  `CARRIER_MP_ACCOUNT_NOT_LINKED`), cuando el emisor ya eligió su oferta: el envío queda
  trabado y el emisor tiene que volver a elegir.
- **Licencia**: el equipo decidió que la insignia de "transportista verificado" pase a
  ser condición para operar (MOVO-116 lo pide explícito), aceptando que se pierde el caso
  del transportista sin vehículo propio.

## Decisión

1. **Para operar como transportista hacen falta tres cosas**: KYC de identidad aprobado
   (prerequisito, igual que antes), licencia de conducir aprobada
   (`kyc_status_license = approved`, `svc-users`) y una cuenta de Mercado Pago con la que
   hoy se pueda cobrar (`svc-payments`, mismo criterio que el hold: no desvinculada, no
   revocada, token sin vencer y con `public_key`).
2. **Dónde se exige** (`svc-shipments`, `utils/carrier-gate.ts`): declarar viaje
   (`POST /trips`), ofertar (`POST /shipments/:id/offers`), editar una oferta
   (`PATCH /offers/:id`) e iniciar un viaje (`POST /trips/:id/start`, sobre el dueño del
   viaje). Al aceptar una oferta (`POST /offers/:id/accept`) se revalida al transportista y,
   si ya no cumple, el emisor recibe 409 `OFFER_CARRIER_NOT_ELIGIBLE` sin detalle y la
   oferta sigue `pending`. Las **lecturas** (feed, detalle de un envío publicado, mis
   viajes, matches) siguen pidiendo solo identidad: se puede mirar antes de completar los
   requisitos.
3. **Error explícito y accionable**: 403 con `code` = el primer requisito que falta
   (`CARRIER_LICENSE_NOT_APPROVED`, si no `CARRIER_MP_ACCOUNT_NOT_LINKED`) y
   `details.missingRequirements` con todos (`["license", "mp_account"]`). Para eso
   `ApiError` (`@movo/shared`) gana un campo `details` opcional, compatible hacia atrás.
4. **Consulta síncrona REST sin cache** (ADR-001): dos endpoints internos nuevos,
   `GET /internal/users/:id/kyc-status` y `GET /internal/payments/mp-connect/:userId/status`,
   consultados en paralelo. Si cualquiera no responde, el bloqueo **falla cerrado** (502),
   mismo criterio que el bloqueo de usuarios en escrituras (ADR-026).

## Alternativas descartadas

- **Mantener la licencia como insignia** (MOVO-142) y exigir solo Mercado Pago: descartado
  por decisión de producto.
- **Leer la licencia de `PublicProfile.badges`** (`license_verified`) con la llamada que ya
  existía: cero endpoints nuevos, pero ata un control de acceso a una derivación pensada
  para mostrar en el perfil, y `GET /users/:id` además pide la reputación a `svc-shipments`.
- **Cachear el resultado en Redis** (criterio 4 del ticket): cachear un negativo deja
  bloqueado a quien acaba de vincular su cuenta; cachear solo los positivos deja operar
  unos minutos a quien acaba de desvincularse. Las escrituras protegidas son pocas por
  transportista, así que el costo de no cachear es bajo.
- **Un código combinado** para "faltan los dos": combinatoria rígida que crece con cada
  requisito nuevo; `details` escala sin códigos nuevos.

## Trade-off aceptado

- Se pierde el transportista sin vehículo propio (el caso que MOVO-142 quería cubrir).
- Dos llamadas síncronas más por escritura de transportista: si `svc-users` o
  `svc-payments` están caídos, nadie puede declarar viajes ni ofertar (falla cerrado).
- Perder la cuenta de MP a mitad de un viaje en curso no se trata acá (regla de negocio sin
  definir, fuera del alcance de MOVO-116): solo se revalida al iniciar el viaje y al aceptar
  una oferta. El hold de MOVO-209 sigue revalidando al cobrar.
- Hoy nada escribe `revoked_at` (MOVO-243), así que el único motivo real de "cuenta no
  vigente", además de no haber vinculado, es el vencimiento del token.

**Referencias**: MOVO-116 (este ticket), MOVO-117 (UI de requisitos pendientes), MOVO-142
(decisión que se revierte), MOVO-15 (licencia), MOVO-111/112 (vinculación de MP), MOVO-209
(hold), ADR-026 (criterio de fallar cerrado).
