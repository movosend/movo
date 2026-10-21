# ADR-041 — Pricing por peso facturable con distancia achatada

**Estado:** aceptado (MOVO-276). Borrador para pegar en la sección de ADRs de
`[Movo] 004 - Sprint 0.md` en Drive. Reemplaza la parte de **cálculo** de ADR-025
(`demand_fuel_routes_v1`); combustible, recargo por demanda, fallback a Haversine × 1,3 y
contrato de `/quote` siguen como los dejó ADR-025.

## Contexto

`demand_fuel_routes_v1` casi no usaba el paquete para cotizar: el peso entraba lineal y
barato (~300 $/kg) y el volumen no entraba. Un televisor de 105 × 65 × 15 cm costaba
apenas más que una caja de zapatos, y un cubo de 1 m³ lo mismo que una caja compacta de
10 kg. La distancia ya se había achatado con un hotfix (tramos decrecientes, 10/10/2026)
pero esa curva nunca se había documentado ni calibrado contra una referencia.

Correo Argentino, Andreani, OCA y Mercado Envíos cotizan con el mismo modelo, aunque sus
números no sean públicos: **peso facturable** (máximo entre real y volumétrico, L × A × H /
5000), distancia **por zonas**, tramos de peso y **límites duros** de peso y medidas.

## Decisión

1. **Método nuevo `package_tapered_v2`** (`PriceCalculationMethod`, `@movo/shared` y
   Python). Los envíos ya creados conservan su precio congelado y su método
   (`demand_fuel_routes_v1` o `euclidean_linear_v1`): nada recalcula un precio persistido
   (MOVO-82 AC8, MOVO-255).
2. **Peso facturable** = `máx(peso real, L × A × H / PRICING_VOLUMETRIC_DIVISOR)`, divisor
   5000 por default (Correo/Andreani/OCA; Mercado Libre usa 6000). Los primeros
   `PRICING_WEIGHT_TIER_KG` (10) se cobran a tarifa llena y el resto al
   `PRICING_WEIGHT_TIER_RATE` (35%): sin ese tramo, el cubo de 1 m³ que admiten los límites
   (200 kg volumétricos) cotizaba ~$135.000 a cualquier destino.
3. **Distancia: se conservan los tramos de km del hotfix** (primeros 30 km al 100%, hasta
   300 km al 20%, el resto al 1,5%), ahora formalizados y calibrados.
4. **Categoría**: `letter_document` tiene una tarifa base propia y menor
   (`PRICING_BASE_FARE_DOCUMENT_L`); `fragile_item` lleva un recargo porcentual
   (`PRICING_FRAGILE_SURCHARGE`, 20%) sobre el mismo paquete no frágil.
5. **Un solo precio sugerido**, origen → destino, calculado al cotizar y congelado con el
   `quoteId`. El desvío marginal del transportista (MOVO-219) se muestra, no se cobra.
6. **Límites duros**: 30 kg reales, 150 cm por lado y 300 cm de suma de lados
   (`PACKAGE_MAX_*`, mismas env vars y defaults en `svc-shipments` y
   `svc-pricing-logistics`). `svc-shipments` los valida al cotizar y al crear el envío
   (422 `PACKAGE_LIMITS_EXCEEDED` con `details.violations`) antes de cualquier I/O, y
   `/quote` responde 422 con el mismo criterio como defensa.
7. **Coeficientes en litros de nafta** (como en ADR-025), calibrados con una grilla de
   referencia: para `standard_package` de hasta 10 kg facturables en rutas de 200 km o
   más, el precio cae **entre 0,6× y 1,0× del Correo clásico a domicilio**. La grilla
   (`docs/pricing/grilla-referencia.md`, `tests/pricing_grid.py`) queda como golden tests
   del motor, con 100% de cobertura exigida en CI sobre los módulos de pricing.

## Alternativas evaluadas

**Forma del achatamiento de la distancia**

- **Zonas escalonadas** (lo que hace la industria): fácil de explicar, pero el precio salta
  en los bordes de cada zona (un km más puede costar un 20% más) y MOVO no tiene una matriz
  de zonas por código postal. Descartada.
- **Curva cóncava** (ej. raíz o logaritmo de la distancia): suave, pero difícil de explicar
  en la defensa y de calibrar contra una referencia por tramos. Descartada.
- **Tramos de km con tarifa marginal decreciente** (elegida): continua, monótona y cóncava
  por construcción, y cada parámetro se lee como "cuánto cuesta un km más en este tramo".

**Base del precio**

- **Desvío marginal del transportista como base** (cobrar lo que le cuesta desviarse):
  exigiría un precio por transportista, distinto del que vio el emisor, y chocaría con la
  cotización congelada de ADR-028. Descartada: el desvío se informa al transportista y él
  lo traduce en su oferta.

**Frágil: categoría o atributo**

- Convertir frágil en un booleano combinable con la categoría separaría tamaño de
  manipulación ("un frasco y un televisor frágiles no deberían costar lo mismo"), pero
  cambia el modelo de datos del envío y el wizard mobile. Con el peso facturable el tamaño
  ya entra en el precio de un `fragile_item`, así que el problema que motivaba el cambio
  desaparece sin migrar nada. Se mantiene como categoría.

**Límites duros**

- Andreani acepta 50 kg reales y 300 cm de suma de lados (165 cm por lado). Se tomó la suma
  de 300 cm pero 30 kg y 150 cm por lado: el transportista de MOVO es una persona en su auto,
  no un camión de reparto, y 30 kg/150 cm ya eran los máximos que validaba el schema del
  envío desde MOVO-80.
- **Límites según el vehículo del transportista** (una moto no carga lo que un auto): queda
  fuera; el límite es del paquete. Lo que el transportista no puede llevar lo resuelve no
  ofertando.

## Trade-offs aceptados

- **El documento a larga distancia sigue siendo caro** (~$15.500 a 1.500 km, más que 1 kg
  por Correo): su precio es casi todo distancia y una base menor no alcanza. Corregirlo
  exigiría una tarifa por km por categoría; queda para recalibrar con datos reales.
- **La caja de zapatos a CABA queda en 0,99× del Correo**, al borde del techo de la banda.
  Con la distancia real de Google (menor que la del mock de la grilla) el cociente baja,
  pero cualquier recalibración tiene que volver a pasar los golden tests.
- **La banda solo cubre `standard_package` de hasta 10 kg facturables en rutas de 200 km o
  más**: el Correo no publica tramos mayores ni sirve de referencia para envíos urbanos
  (ahí la competencia es la mensajería en moto). El resto queda cubierto solo por las
  propiedades de forma: monotonía en distancia y peso facturable, y concavidad en distancia.
- **Las medidas siguen siendo las que declara el emisor**: quien subdeclara paga menos. No
  hay verificación más allá de las fotos del retiro.
- **Los límites se configuran en dos servicios**: si se recalibran, hay que cambiarlos en los
  dos (y el mobile replica 150 cm por lado y 300 cm de suma para el aviso en línea; el 422
  del backend sigue siendo la fuente de verdad).

**Referencias**: MOVO-276, MOVO-138/ADR-025, MOVO-216 (spike), MOVO-219 (desvío marginal),
MOVO-255/ADR-028 (cotización congelada), MOVO-82/ADR-018.
