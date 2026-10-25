# DD-053 — Oferta de transportistas del recargo por demanda: solo viajes `declared`

**Estado:** aceptado (MOVO-270). Borrador para pegar en
`[Movo] 011-Registro de Decisiones de Diseño` en Drive. Ajusta el insumo de oferta de ADR-021 sin modificarlo;
DD-041 reemplazó el cálculo de ADR-021 pero no el recargo por demanda.

## Contexto

El recargo por alta demanda de ADR-021 compara los envíos publicados a 15 km del retiro contra
los transportistas disponibles (`TripRepository.countAvailableCarriersNear`): transportistas
distintos con un viaje que sale en [ahora − 6 h, ahora + 72 h] y cuyo corredor pasa a menos de
15 km del retiro. Contaba viajes `declared` **y** `active`.

Desde MOVO-258 (DD-032) los paquetes de un viaje quedan fijos al iniciarlo: un viaje `active`
ya no recibe ofertas, no aparece en matches ni recibe el push de paquete compatible. Contarlo
como oferta sobreestima a los transportistas disponibles y a veces no aplica el recargo cuando
debería.

## Decisión

1. **Solo cuentan los viajes `declared`.** No se midió el impacto antes de cambiarlo: el cambio
   es semánticamente correcto y su efecto ya está acotado, porque un viaje `active` solo entra en
   la ventana si salió hace menos de 6 h (MOVO-277: no se inicia antes del día de salida).
2. **El umbral no cambia** (`(publicados a 15 km + 1) / transportistas ≥ 3`, con al menos 4 envíos,
   recargo de 10 % + 5 % por punto de ratio, tope 30 %). `package_tapered_v2` (DD-041) cambió el
   subtotal pero aplica el mismo multiplicador de demanda que ADR-021 sobre él, así que el
   umbral sigue midiendo lo mismo. Sacar los `active` del denominador ya hace que el recargo
   aparezca en los casos que se perdía. Se revisa con datos reales de dev, no en este ticket.

## Limitaciones aceptadas

- **Las ocurrencias autogeneradas de viajes recurrentes (DD-042) cuentan** como cualquier
  `declared`, aunque el transportista no haya confirmado esa salida puntual.
- **Los transportistas inhabilitados** (deuda vencida MOVO-313, disputa abierta MOVO-278 AC9)
  **siguen contando**. Filtrarlos implicaría consultar `carrier-gate.ts` (y con él `svc-users` y
  `svc-payments`) desde un conteo que corre en cada cotización.

Las dos sobreestiman la oferta en el mismo sentido que lo hacían los `active`, pero en casos
mucho menos frecuentes.

**Referencias**: MOVO-270 (este ticket), ADR-021 (MOVO-138, recargo por demanda), DD-041
(MOVO-276, `package_tapered_v2`), DD-032 (MOVO-258, paquetes fijos al iniciar), DD-034
(MOVO-277, inicio de viaje), DD-042 (MOVO-265, recurrentes), MOVO-313 (bloqueo por deuda).
