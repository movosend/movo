# ADR-045 — Salida para un envío `in_transit` demorado: aviso, disputa automática y bloqueo del transportista

**Estado:** aceptado (MOVO-278). Borrador para pegar en la sección de ADRs de
`[Movo] 004 - Sprint 0.md` en Drive. Complementa ADR-032 (MOVO-258) sin modificarlo y suma
un requisito a ADR-036. ADR-043 y ADR-044 los reservan MOVO-307/309/310/313.

## Contexto

ADR-032 (D4) decidió que un envío `in_transit` que no se entrega **nunca se cancela**: el
paquete está en manos de alguien. El barrido lo marca (`transit_anomaly_flagged_at`, entrega
estimada + 50% de la duración, o 48 h desde el retiro sin estimada) y le pregunta al
transportista si tuvo un inconveniente. La salida prevista (disputa o alerta de admin,
MOVO-30/MOVO-33) nunca se construyó. Consecuencias:

- **La marca no la lee nadie.** El emisor ve "En camino" para siempre.
- **El viaje no se cierra.** Un `in_transit` no cuenta como terminado, el viaje queda `active`
  y el índice de un viaje activo por transportista (MOVO-221) le impide iniciar otro.
- **El mapa en vivo queda solo con el pin de destino**: la última posición vence a los 7 días
  (ADR-024) y nada explica por qué no hay ubicación.

Caso real en dev: un envío `in_transit` desde el 21/09, marcado el 04/10, seguía en el Home
del emisor como "En camino".

## Decisión

1. **La marca se expone** (`transitAnomalyFlaggedAt`) en `GET /shipments/sending|receiving|
   transporting` y en `GET /shipments/:id`. La app muestra "Demorado" (tono warning, sin halo
   pulsante) con una explicación, y el mapa en vivo un estado explícito "No tenemos la
   ubicación del transportista".
2. **Aviso previo** a las `IN_TRANSIT_ANOMALY_WARN_AFTER_HOURS` (12 h) de la marca: push al
   transportista ("si no confirmás la entrega, se abre una disputa y no vas a poder operar").
   Una sola vez por envío, con una columna durable (`transit_anomaly_warned_at`, compare-and-
   swap antes de la push) y no con un claim de Redis: tiene que sobrevivir a un flush.
3. **Disputa automática** a las `IN_TRANSIT_ANOMALY_DISPUTE_AFTER_HOURS` (24 h) de la marca:
   `in_transit → disputed` (arista que ya existía), sin actor (`actor_id` nulo) y con motivo
   explícito, avisando a emisor, receptor y transportista. `expectedFrom: in_transit` hace que
   una entrega confirmada mientras corre el barrido gane: la marca nunca bloquea el handshake.
4. **El viaje se cierra solo**: `disputed` ya cuenta como terminado para
   `completeFinishedActive` (ADR-032), así que se libera el índice de un viaje activo.
5. **Bloqueo del transportista con una disputa abierta** (requisito nuevo de ADR-036,
   `no_open_dispute`): declarar viaje, ofertar, editar oferta e iniciar viaje responden 403
   `CARRIER_DISPUTE_OPEN` con el requisito en `details.missingRequirements` (va primero: es el
   único que el transportista no puede resolver). Aplica a cualquier envío `disputed` como
   transportista, automático o iniciado por un usuario (MOVO-30). Es una consulta local
   (misma DB), falla cerrado como el resto del gate y no corta envíos ya en curso. Por la
   revalidación al aceptar, el emisor tampoco puede elegir la oferta de un transportista con
   una disputa abierta (409 `OFFER_CARRIER_NOT_ELIGIBLE`), y la serie de viajes recurrentes se
   corta (ADR-042: los requisitos ya no permiten declarar).

## Por qué 12 h y 24 h

- **24 h es consistente con el barrido de retiro no realizado** de ADR-032 (24 h de gracia).
- **Queda claramente por debajo del vencimiento del hold de Mercado Pago**
  (`MP_HOLD_VALIDITY_DAYS`, 5 días por default y provisorio hasta MOVO-215/MOVO-305). La marca
  ya llega tarde respecto de la entrega estimada; sumar más espera deja al emisor sin respuesta
  y acerca el vencimiento del hold.
- **12 h de aviso** deja medio plazo para que el transportista confirme la entrega si la hizo
  y se olvidó del handshake, el caso más probable.
- **Son variables de entorno, no una decisión irreversible**: se revisan con casos reales de dev
  y testing. El servicio no arranca si el aviso no es anterior a la disputa.

## Hold de fondos mientras la disputa está abierta

La disputa automática **no libera ni captura el hold**: eso queda para la resolución (MOVO-34).
Si la disputa dura más que la validez del hold, el hold vence y **la captura no se reintenta**
(mismo criterio que MOVO-306/MOVO-307 AC6). Riesgo conocido y aceptado: con el hold vencido, el
cobro al transportista tras una resolución a favor del emisor pasa por el ajuste manual del
ledger de MOVO-309 (`manual_adjustment`), no por un mecanismo de deuda aparte.

## Alternativas descartadas

- **Cancelar el envío** (en vez de disputar): el paquete está en manos de alguien; cancelarlo
  borra el problema sin resolverlo. ADR-032 ya lo había descartado.
- **Solo alertar al admin**: no existe panel de admin (MOVO-33) y el viaje seguiría trabado.
- **Contar `in_transit` marcado como terminado para el viaje**: liberaba al transportista sin
  consecuencia y dejaba el envío en un limbo sin salida.
- **Dejar que el transportista confirme la entrega tarde para levantar el bloqueo**: se decidió
  no dar esa salida por ahora; si se revisa, tiene que encajar con el handshake (ADR-020).

## Trade-off aceptado

- **El bloqueo no tiene salida hasta MOVO-34**: `disputed` no tiene transición de salida
  modelada, así que un transportista con una disputa abierta queda bloqueado hasta que exista
  la resolución por un administrador.
- **"Demorado" no promete una revisión**: el texto describe lo que el sistema hace solo (abrir
  una disputa), porque hoy nadie revisa las disputas.
- Un aviso cuya push falla no se reintenta (la marca ya se escribió); la disputa llega igual.
- Los TyC tienen que cubrir "Demorado" y la disputa automática (MOVO-316).

**Referencias**: MOVO-278 (este ticket), MOVO-258/ADR-032 (marca de D4), ADR-036 (requisitos
habilitantes), ADR-024 (vencimiento de la última posición), MOVO-30/33/34 (disputas y panel),
MOVO-305/306/307/309 (hold, captura y ledger), MOVO-313 (otro requisito del mismo gate),
MOVO-316 (TyC).
