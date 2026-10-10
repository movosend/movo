# ADR-034 — Arquitectura de cobro: Payments API + OAuth Connect + `application_fee`

**Estado:** aceptado (MOVO-209). Borrador para pegar en la sección de ADRs de
`[Movo] 004 - Sprint 0.md` en Drive.

> Numeración: el ticket MOVO-209 lo llamaba ADR-030, pero ese número ya lo ocupa el
> juego de precios del sitio institucional. El siguiente libre al escribirlo es el 034.

## Contexto

MOVO conecta a un emisor que paga con un transportista que cobra, y no quiere tocar el
dinero ni ser un intermediario financiero. Hay que reservar el monto al aceptar una
oferta, cobrarlo recién al entregar, y repartirlo en el mismo acto (comisión de Movo y
neto del transportista). El spike MOVO-49 verificó en sandbox qué combinaciones de la
API de Mercado Pago lo permiten (`docs/payments/mercadopago-spike/SOLUCION-FINAL.md`).

## Decisión

1. **Marketplace de Mercado Pago**: el pago se crea en la **Payments API** con el
   `access_token` OAuth **del transportista** (vendedor), y la comisión de Movo viaja como
   `application_fee`. MP acredita el neto directo al transportista y retiene la comisión
   para Movo en la misma operación: Movo nunca custodia el dinero.
2. **Vinculación por OAuth Connect + PKCE** (MOVO-111). Los tokens se guardan cifrados
   (AES-256-GCM) en `svc-payments`, único servicio que habla con MP.
3. **Hold = Auth & Capture** (`capture: false`): reserva sin cobrar. Se libera con
   `status: cancelled` y se captura al confirmarse la entrega (MOVO-212).
4. **SDK oficial `mercadopago` v3** para pagos, con `X-Idempotency-Key` obligatoria en
   cada escritura. El canje y el refresh de OAuth van con `fetch` propio (el SDK no tipa
   `code_verifier`/`test_token` y exige un access token que `/oauth/token` no usa).
5. **El hold se crea siempre con el emisor presente**: el mobile tokeniza la tarjeta con
   la `public_key` **del transportista** y el backend nunca ve el número. Cobrar sobre una
   tarjeta guardada sin el emisor (card-on-file / off-session) **se descartó**: no se pudo
   validar en el modelo marketplace (error 128 al guardarla, SOLUCION-FINAL §7).
6. **Un intento de reserva = una fila y una idempotency key**
   (`movo-hold-<shipmentId>-<attempt>`). Un reintento del mismo intento reusa la key; un
   rechazo o una liberación abre el intento siguiente. Un índice único parcial en
   Postgres garantiza un solo hold vivo por envío.
7. **Comisión**: `application_fee` = `decomposeOfferGrossPrice(monto).commissionAmountArs`
   de `@movo/shared`. El monto que paga el emisor es el bruto (`Offer.priceOffered`) y
   Movo cobra su porcentaje sobre el neto del transportista (MOVO-143 AC6), no sobre el bruto.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Movo recibe el pago en su cuenta y le transfiere al transportista | Movo pasa a custodiar dinero ajeno (obligaciones regulatorias, riesgo de contraparte) y hay que programar y conciliar los payouts. |
| Checkout Pro / Preferences | No permite reservar sin cobrar con split por transportista con este modelo de cuentas. |
| Pago en efectivo con cobro de comisión posterior | Queda en el backlog (MOVO-37): no reserva nada y depende de cobrarle después al transportista. |
| Tarjeta guardada + hold off-session | No validado en marketplace; ver punto 5. |
| Renovar holds vencidos | Puede fallar con el paquete en tránsito, bloquea doble monto y parece un doble cobro (decisión de MOVO-12). |

## Consecuencias y trade-offs aceptados

- **Dependencia de que el transportista tenga la cuenta vinculada y vigente**: sin ella no
  hay `public_key` ni token para cobrar (`CARRIER_MP_ACCOUNT_NOT_LINKED`). Los tokens
  vencen a los 180 días; renovarlos es MOVO-243.
- **El emisor tiene que estar presente** al crear el hold: la reserva de un retiro lejano
  se difiere hasta que el emisor confirma el pago cerca de la fecha (ADR-021, MOVO-210).
- **El plazo del hold lo decide Mercado Pago** y su documentación se contradice (5 o 7
  días). Se parametriza (`MP_HOLD_VALIDITY_DAYS`, hoy 5 provisorio) hasta que MOVO-215 lo mida.
- **Dos requests casi simultáneos o una respuesta perdida** se resuelven por idempotencia
  y por un índice único parcial, no con locks distribuidos. Un intento sin respuesta de MP
  (`creating`) se reintenta con la misma key si el cuerpo coincide; si cambió, se busca el
  pago en MP por `external_reference` antes de abrir otro intento. Caso residual aceptado:
  si no hay credenciales del transportista para preguntarle a MP, el intento viejo se cierra
  igual y, si MP llegó a crearlo, queda un hold huérfano que vence solo (MOVO-268 lo
  reconcilia).
- **Liberar un hold exige el access_token del transportista** (MP solo deja cancelar al
  cobrador). Si desvinculó o MP revocó el acceso, el hold no se puede liberar desde Movo y
  vence solo en MP, con los fondos del emisor retenidos hasta entonces. Pendiente de decisión:
  impedir la desvinculación con holds vivos.
- **El sandbox exige que las tres partes sean cuentas de prueba** y que el pagador use el
  email real de una cuenta Comprador; con uno inventado MP crea un invitado y responde
  2034. Producción puede requerir homologar el modelo Marketplace en la cuenta real de
  Movo (pregunta abierta en el hilo de soporte de MP).
- **Credenciales**: nunca se loguean tokens ni datos de tarjeta (redacción en el logger,
  MOVO-267).

## Referencias

- `docs/payments/flujo-de-pagos.md`
- `docs/payments/mercadopago-spike/SOLUCION-FINAL.md`
- ADR-004 (JWT/tokens), ADR-010 (confianza perimetral), ADR-019, ADR-021
- Tickets: MOVO-49, MOVO-111, MOVO-209, MOVO-210, MOVO-212, MOVO-215, MOVO-268
