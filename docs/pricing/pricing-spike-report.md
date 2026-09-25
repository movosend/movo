# MOVO-216: Spike técnica: pricing dinámico (demanda + combustible) y contrato simplificado de `POST /quote`

> **Proyecto MOVO**: Plataforma logística P2P
> **Ubicación:** `docs/pricing/pricing-spike-report.md`
> **Prototipo:** [`docs/pricing/pricing_prototype.py`](./pricing_prototype.py)
> **Autora:** Alena Ariza · datos relevados el 24/09/2026

---

## 1. Ficha técnica

- **Ticket:** [MOVO-216](https://linear.app/movosend/issue/MOVO-216). Desbloquea [MOVO-138](https://linear.app/movosend/issue/MOVO-138) (motor de precios real).
- **Contexto:** `POST /quote` responde hoy con `euclidean_linear_v1` (MOVO-82, ADR-018), una fórmula lineal provisoria con coeficientes fijos en pesos. MOVO-138 la reemplaza por `demand_fuel_routes_v1`. Esta spike fija qué fuente de combustible usar, cómo se mide la demanda y qué contrato ve el consumidor.
- **Resultado en una línea:** el precio del combustible sale de la API CKAN de la Secretaría de Energía (mediana nacional de nafta súper con declaraciones de los últimos 30 días, cacheada 24h en Redis). La alta demanda es `(envíos publicados en la zona + 1) / transportistas disponibles ≥ 3`, con un mínimo de 4 envíos, y aplica un recargo de 10% a 30%. `svc-shipments` manda los dos conteos en el request y el emisor recibe solo `suggestedPriceArs` + `highDemand` + `calculationMethod`.

## 2. Cumplimiento del alcance

| Ítem del alcance | Estado | Dónde |
| :--- | :---: | :--- |
| 1a. Prototipar la función de recargo por demanda (paquetes publicados vs. transportistas/viajes en la zona) | ✅ | §4.2, `demand_multiplier()` y `count_zone_demand()` |
| 1b. Definir el umbral de "alta demanda" | ✅ | §4.3: ratio ≥ 3,0 y ≥ 4 envíos, calibrado con Monte Carlo |
| 2a. Seleccionar e integrar una API de precios de surtidor | ✅ | §3: CKAN de datos.energia.gob.ar, probada en vivo (dos vías de consulta) |
| 2b. Definir la frecuencia de consulta y el cacheo | ✅ | §3.4: TTL fresco de 24h, último valor bueno 7 días y fallback de config |
| 3. Validar el contrato sin desglose, solo precio + flag | ✅ | §6: `breakdown` sale del wire (sin consumidores hoy) y pasa al log |
| Entregable: informe técnico | ✅ | este documento |
| Entregable: prototipo ejecutable | ✅ | `pricing_prototype.py` (solo stdlib, `--offline` opcional) |

---

## 3. API de precios de combustible

### 3.1. Fuentes evaluadas

| Opción | A favor | En contra | Veredicto |
| :--- | :--- | :--- | :--- |
| **CKAN de la Secretaría de Energía** (dataset "Precios en surtidor, Res. 314/2016") | Oficial, gratuita, sin API key, licencia CC-BY-4.0. Actualización diaria, cobertura nacional y SQL en el servidor | Solo HTTP, datos declarados por las estaciones (con basura, ver §3.3), SLA desconocido | ✅ **Elegida** |
| Precios publicados por YPF u otras petroleras (scraping del sitio) | Precio "de pizarra" limpio | Sin API pública; el scraping se rompe con cualquier cambio de HTML y sus términos de uso son dudosos | ❌ |
| APIs privadas agregadoras | JSON prolijo | Pagas o sin garantía de continuidad; otro proveedor externo más, contra el criterio de costos de R10 | ❌ |
| Precio fijo en config, actualizado a mano | Trivial | En Argentina queda desactualizado en semanas, que es justo el problema a resolver | Solo como **fallback** (§3.4) |

### 3.2. Cómo se consulta

- Recurso: `80ac25de-a44a-4445-9215-090cf55cfda5` ("Precios vigentes en surtidor"), dentro del dataset `1c181390-…`. Tiene unas 36.700 filas: estación × producto × horario (diurno/nocturno).
- Columnas útiles: `idproducto`, `producto`, `idtipohorario`, `precio` (ARS/l), `fecha_vigencia`, `provincia`, `latitud`, `longitud`.
- Productos: `2` nafta súper, `3` nafta premium, `19` gasoil grado 2, `21` gasoil grado 3, `6` GNC.
- **Vía primaria, `datastore_search_sql`:** Postgres calcula la mediana en el servidor y devuelve una sola fila. Latencia medida: 0,13 a 0,52 s.
  ```sql
  SELECT COUNT(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY precio) AS mediana
  FROM "80ac25de-a44a-4445-9215-090cf55cfda5"
  WHERE idproducto = 2 AND idtipohorario = 2
    AND fecha_vigencia >= NOW() - INTERVAL '30 days'
  ```
- **Vía alternativa, `datastore_search` con `filters`:** algunos CKAN deshabilitan el endpoint SQL. Esta vía trae las ~4.200 filas del producto (~360 KB, 0,25 a 0,35 s) y filtra y agrega localmente. Las dos vías dan el mismo resultado: **2.223 ARS/l con 619 muestras**.

### 3.3. Hallazgos empíricos (lo que un consumo ingenuo haría mal)

1. **Los precios "vigentes" no son vigentes.** Cada estación figura con su *última* declaración, aunque sea de hace años. En Córdoba, 361 de 490 filas de nafta súper son anteriores a 2026 y hay precios de $20,85/l. **La mediana ingenua da $1.346/l y la real es ~$2.249/l, un 40% de subestimación.** Por eso el filtro de frescura de 30 días es obligatorio.
2. **Cobertura provincial despareja.** Con la ventana de 30 días, Buenos Aires tiene 292 muestras de nafta súper y Córdoba 76, pero La Rioja, Salta, San Luis y Santa Cruz tienen **1 muestra** y Jujuy, Formosa y Neuquén 2. Una mediana provincial no es estadísticamente defendible en la mitad del país.
3. **La dispersión entre provincias es chica:** la nafta súper va de ~$1.840 (La Pampa) a ~$2.350 (Misiones, Jujuy), y el grueso de las provincias con muestra suficiente (Buenos Aires, CABA, Córdoba, Santa Fe, Entre Ríos) queda en ±2% de la mediana nacional de $2.222,5. Como toda la tarifa se expresa en litros (§5.2), el precio final se movería en esa misma proporción. Es poco para las provincias donde se concentra la operación, y en las provincias con más dispersión la mediana provincial sale de 1 o 2 estaciones, así que tampoco sería más confiable.
4. **Solo HTTP.** `https://datos.energia.gob.ar` responde 301 a `http://`. Sin TLS, un intermediario podría alterar la respuesta, así que el servicio tiene que tratarla como no confiable (controles de §3.4).
5. **El dataset se actualiza a diario** (`last_modified` del recurso: 25/09/2026 00:00). Consultar más de una vez por día no aporta información.

### 3.4. Decisión: qué precio, cada cuánto, cómo se cachea

- **Precio de referencia:** mediana **nacional** de **nafta súper** (`idproducto=2`), horario diurno, con `fecha_vigencia` de los últimos 30 días.
  - Nacional y no provincial por los puntos 2 y 3 de §3.3. Además, ubicar la provincia del retiro exigiría geocoding inverso por cotización.
  - Nafta y no gasoil porque el transportista P2P típico va en auto particular. Además, al cotizar todavía no hay transportista asignado, así que tampoco se conoce su `vehicleType`.
  - Mediana y no promedio porque es robusta a los outliers que quedan dentro de la ventana.
- **Frecuencia y cache** (servicio `FuelPriceService` en el prototipo, dos claves de Redis en el servicio real):

  | Nivel | Clave Redis | TTL | Uso |
  | :--- | :--- | :--- | :--- |
  | Fresco | `fuel_price:2` | 24h | Mientras exista, **0 llamadas a la API**. El prototipo muestra 1.000 cotizaciones en 23h resueltas con 1 sola llamada |
  | Último valor bueno | `fuel_price:2:lkg` | 7 días | Si la API falla o devuelve algo inverosímil |
  | Config | `PRICING_FUEL_PRICE_FALLBACK_ARS_PER_L` | — | Sin Redis o con la API caída más de 7 días |

  La consulta se hace de forma **lazy**, en la primera cotización después de que vence el TTL, y no con un job periódico. El servicio no tiene scheduler y 0,5 s una vez por día es tolerable. El `timeout` hacia la API tiene que ser de 2 s: por debajo de los 3 s con los que `pricing-client.ts` ya degrada a "precio a estimar", así una API lenta nunca le cuesta el precio al envío. Si la API falla, se sirve el valor bueno anterior.
- **Controles de cordura** (rechazan el valor y usan el anterior): menos de 50 muestras, valor fuera de [500, 10.000] ARS/l, o variación mayor a 25% contra el último valor bueno. El prototipo prueba estos casos con el outlier real de $20,85.
- **La degradación es deliberada.** La política *No-Fallback* de MOVO-205 existe porque una ruta mala le da instrucciones falsas al transportista. Acá el precio de ayer es una aproximación excelente del de hoy, y fallar la cotización solo empeora las cosas: el envío queda en "precio a estimar".

---

## 4. Algoritmo de demanda

### 4.1. Señales disponibles hoy (esquema `shipments`)

| Señal | Fuente | Filtro |
| :--- | :--- | :--- |
| Envíos esperando transportista | `shipments` con `status = 'published'` | Retiro a ≤ 15 km del retiro cotizado (bounding box + Haversine, mismo patrón que `GET /shipments/available`, MOVO-142) |
| Transportistas disponibles | `trips` con `status IN ('declared','active')`, **`COUNT(DISTINCT carrier_id)`** | `departure_at` entre −6h y +72h, y el segmento origen→destino pasa a ≤ 15 km del retiro (prefiltro de corredor de MOVO-50) |

- **15 km** es el mismo umbral del prefiltro de corredor de MOVO-50: un transportista cuenta como oferta si el feed de matches (MOVO-218/219) le mostraría ese paquete.
- **`DISTINCT carrier_id`**: un transportista con dos viajes declarados en la semana cuenta una vez. El prototipo lo verifica.
- Solo se mira la **zona de retiro**: es donde se decide si alguien pasa a buscar el paquete.

### 4.2. Función

```
demanda = envíos publicados en la zona + 1          # +1 = el envío que se está cotizando
ratio   = demanda / max(transportistas disponibles, 1)

alta_demanda = demanda ≥ 4  y  ratio ≥ 3,0
recargo      = min(30%, 10% + 5% × (ratio − 3,0))    si alta_demanda, sino 0
precio       = subtotal × (1 + recargo)
```

| Publicados | Transp. | Ratio | ¿Alta demanda? | Multiplicador |
| ---: | ---: | ---: | :---: | ---: |
| 2 | 0 | 3,0 | no (menos de 4 envíos) | 1,00 |
| 3 | 0 | 4,0 | sí | 1,15 |
| 3 | 5 | 0,8 | no | 1,00 |
| 5 | 2 | 3,0 | sí (en el umbral) | 1,10 |
| 8 | 2 | 4,5 | sí | 1,18 |
| 13 | 2 | 7,0 | sí (tope) | 1,30 |
| 20 | 1 | 21,0 | sí (tope) | 1,30 |

**Propiedades buscadas:**
- **Badge ⇔ recargo.** `highDemand: true` si y solo si el multiplicador es mayor que 1. El emisor nunca ve un recargo sin explicación ni un badge sin efecto. Por eso la función salta de 1,00 a 1,10 en el umbral en vez de arrancar suave.
- **Monótona y acotada.** Más demanda nunca abarata, y el tope del 30% evita precios que un emisor leería como abuso. Es la misma preocupación de Ley 24.240 que ya documenta MOVO-224.
- **Mínimo de volumen.** "1 envío y 0 transportistas" es un mercado vacío, no alta demanda, y un recargo ahí no atrae a nadie.
- **Un solo cálculo por envío.** La cotización se calcula y persiste al crear el envío (`suggestedPriceArs`) y no se recalcula después, así que no hay precio que cambie bajo los pies del emisor.

### 4.3. Calibración del umbral

Todavía no hay datos de producción, así que el umbral se calibró con **Monte Carlo** (sección 4 del prototipo). Cada mercado simula 10.000 zonas donde envíos ~ Poisson(λs) y transportistas ~ Poisson(λc), con λ lognormal entre zonas para tener zonas tranquilas y zonas calientes. Criterio: el badge tiene que ser **excepcional con oferta holgada (<10%)**, **minoritario en equilibrio (~20%)** y **frecuente cuando faltan transportistas (>40%)**. Si aparece siempre, deja de informar.

| Mercado | 2,0 / 3 | 2,5 / 3 | 3,0 / 3 | **3,0 / 4** | 3,0 / 5 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Holgado (λs=2, λc=4) | 18,2% | 14,1% | 12,5% | **8,8%** | 6,4% |
| Equilibrado (λs=3, λc=3) | 36,2% | 29,8% | 26,7% | **22,0%** | 18,1% |
| Escaso (λs=4, λc=1,5) | 65,8% | 59,8% | 56,0% | **48,6%** | 41,4% |

*Columnas: umbral de ratio / mínimo de envíos. Porcentaje = zonas con badge.*

Un umbral de 2,0, que era el primer candidato intuitivo, marca más de un tercio de las zonas en un mercado equilibrado. **3,0 / 4** es la única combinación que cumple los tres criterios. Todos los parámetros quedan en config (`PRICING_DEMAND_*`) para recalibrarlos con datos reales sin tocar código.

### 4.4. Dónde se calcula: `svc-shipments` manda los conteos

`movo-svc-pricing-logistics` no tiene base de datos (ADR-019) y los datos de demanda viven en el esquema `shipments`. Opciones:

| Opción | Veredicto |
| :--- | :--- |
| **(a) `svc-shipments` cuenta y manda `demandContext: {publishedShipments, availableCarriers}` en el request de `POST /quote`** | ✅ **Elegida.** `/quote` hoy solo lo llama `svc-shipments` (el gateway no lo expone, `routes-map.ts`), que ya tiene los datos. Pricing sigue stateless y determinístico, y se testea con dos enteros. Sin salto de red extra |
| (b) Pricing le pide los conteos a `svc-shipments` por HTTP | ❌ Dependencia circular (shipments → pricing → shipments en el mismo request) y un salto más en el camino crítico de `createShipment` |
| (c) Pricing lee el esquema `shipments` directo | ❌ Rompe "un esquema por servicio" (ADR-003) y contradice ADR-019 |

El campo es **opcional**: sin `demandContext`, no hay recargo. Así el contrato sigue sirviendo para cotizar sin contexto (por ejemplo, el wizard mobile de MOVO-83 si alguna vez llama sin pasar por `createShipment`). Las dos consultas usan los índices existentes (`shipments_status_pickup_lat_lng_idx` y `trips_status_idx`/`trips_departure_at_idx`).

**Descartado:**
- **Grilla fija (geohash/H3).** Tiene efecto borde: dos retiros a 200 m pero en celdas distintas cotizan distinto. El radio centrado en el retiro no tiene ese problema y reusa código existente.
- **Tiempo histórico de asignación como señal.** Sería mejor, pero no hay datos todavía.
- **Multiplicador continuo sin umbral.** Rompe "badge ⇔ recargo".

---

## 5. Fórmula `demand_fuel_routes_v1`

### 5.1. Estructura

```
P       = precio nafta súper (ARS/l, §3.4)
por_km  = (0,08 l/km × 0,6 + 0,02 l/km) × P       # combustible compartido + desgaste/peajes
subtotal = (0,675 l × P  +  distancia_vial_km × por_km  +  peso_kg × 0,135 l × P) × factor_tipo_paquete
precio  = redondeo_a_$10(subtotal × multiplicador_demanda)
```

- **`distancia_vial_km`** sale de `RoutesProvider` (ADR-015), con una matriz 1×1 origen→destino: 1 elemento, US$0,005 por cotización. El prototipo usa Haversine × 1,3 como mock.
- **`FUEL_COST_SHARE = 0,6`.** En un modelo P2P el transportista ya hacía el viaje, así que el emisor comparte el costo del combustible en vez de pagarlo entero, igual que en el carpooling. Es un parámetro de negocio, no técnico.
- **`factor_tipo_paquete`** se mantiene igual que en v1 (frágil ×1,2).
- `urgent` sigue sin afectar el precio, igual que en v1. Queda fuera de alcance.

### 5.2. Coeficientes en litros, no en pesos (indexación automática)

Todos los coeficientes se expresan en **litros de nafta equivalentes**, no en ARS. En v1, `1500 / 150 / 300` pesos se desactualizan con la inflación y alguien tiene que acordarse de subirlos. Expresados en litros, **toda la tarifa se indexa sola con el surtidor**. El prototipo lo muestra: si la nafta sube 20%, el precio sube 20% sin tocar ninguna config.

Los valores están calibrados para que, al precio del 24/09/2026 ($2.223/l), la tarifa coincida con la de v1: base 0,675 l ≈ $1.500, por km ≈ $151, por kg 0,135 l ≈ $300. Así el cambio de método no es un salto de precio.

| Caso | v1 (línea recta) | v1 con distancia vial | **v1 nuevo** | vs. vial | Badge |
| :--- | ---: | ---: | ---: | ---: | :---: |
| Córdoba → Villa María, 3 kg, zona tranquila | 23.669 | 30.050 | **30.230** | +1% | no |
| Córdoba → Villa María, 3 kg, alta demanda (9 publicados / 2 transp.) | 23.669 | 30.050 | **36.280** | +21% | sí |
| Nueva Córdoba → Cerro, sobre | 2.639 | 2.963 | **2.970** | 0% | no |
| Córdoba → Carlos Paz, frágil 5 kg (12 / 1) | 8.980 | 10.594 | **13.830** | +31% | sí |

Sin demanda, el precio nuevo es igual al de v1 con la misma distancia. **La diferencia contra v1 "tal cual" viene casi entera de pasar de línea recta a distancia por ruta**, que es la corrección que pide MOVO-138. Conviene avisarle al equipo que los precios suben ~25-30% en trayectos interurbanos por ese motivo, no por la tarifa.

---

## 6. Contrato de `POST /quote`

### 6.1. Request (se suma un campo opcional)

```json
{
  "originLat": -31.4167, "originLng": -64.1833,
  "destinationLat": -32.4075, "destinationLng": -63.2403,
  "weightKg": 3, "lengthCm": 30, "widthCm": 20, "heightCm": 15,
  "packageType": "standard_package", "urgent": false,
  "demandContext": { "publishedShipments": 9, "availableCarriers": 2 }
}
```

### 6.2. Response (lo único que ve el consumidor)

```json
{ "suggestedPriceArs": 36280, "highDemand": true, "calculationMethod": "demand_fuel_routes_v1" }
```

- **`breakdown` sale del wire.** Se verificó con grep que **ningún consumidor lo lee**: `pricing-client.ts` solo usa `suggestedPriceArs` y `calculationMethod`, y `movo-mobile` no lo referencia. Solo lo declara `QuoteResponse` de `@movo/shared`. Quitarlo no rompe nada.
- **El desglose no se pierde.** Queda en un log estructurado `pricing_quote_computed` con el precio del combustible y su fuente (`api`/`lkg`/`config`), la distancia, los componentes, el ratio y el multiplicador. Sirve como evidencia para disputas (MOVO-30) y para la defensa, sin exponérselo al emisor.
- **El texto del badge ("Alta demanda en tu zona") vive en el mobile**, no en el backend. El backend devuelve un booleano y la redacción es de la UI.
- **`highDemand` se persiste en el envío** (`shipments.high_demand`, ver §7.4), así el badge se puede mostrar después en el detalle.
- **Compatibilidad:** agregar `highDemand` y quitar `breakdown` no rompe `pricing-client.ts`. Da igual qué servicio se despliegue primero.

---

## 7. Recomendaciones para MOVO-138

1. **`FuelPriceProvider` con el molde de ADR-012/014/017:** `FUEL_PRICE_PROVIDER=mock|energia`, con `mock` (valor fijo) como default de dev/test/CI para no depender de una API externa en los tests. El `energia` real lleva `httpx` (ya es dependencia) y cache en Redis (MOVO-217 ya dejó el cliente).
2. **Env vars nuevas.** Cada una va en los **tres lugares** (`.env.example`, `app/config.py` y `environment:` de `infra/docker-compose.yml`). `FUEL_PRICE_PROVIDER` va con `:-mock`, no con `-mock`. Lista: `FUEL_PRICE_PROVIDER`, `PRICING_FUEL_PRICE_FALLBACK_ARS_PER_L`, `PRICING_FUEL_CACHE_TTL_SECONDS`, `PRICING_DEMAND_RATIO_THRESHOLD`, `PRICING_DEMAND_MIN_SHIPMENTS`, `PRICING_DEMAND_BASE_SURCHARGE`, `PRICING_DEMAND_SLOPE`, `PRICING_DEMAND_MAX_SURCHARGE`, y los coeficientes en litros (`PRICING_BASE_FARE_L`, `PRICING_FUEL_L_PER_KM`, `PRICING_FUEL_COST_SHARE`, `PRICING_NON_FUEL_L_PER_KM`, `PRICING_PER_KG_L`). El radio de 15 km y el horizonte de 72h los usa `svc-shipments`, que es quien cuenta.
3. **`@movo/shared`:** `PriceCalculationMethod.DEMAND_FUEL_ROUTES_V1 = "demand_fuel_routes_v1"`, sin borrar `EUCLIDEAN_LINEAR_V1` porque queda persistido en envíos viejos. Además `QuoteRequest.demandContext?` y `QuoteResponse.highDemand` (y sin `breakdown`). Hay que tocar el enum de Python en el mismo PR.
4. **`svc-shipments`: conteos + persistir `highDemand` (decidido).** Contar la demanda antes de `getQuote()`, sumar `highDemand` a `QuoteResult`, y **persistir el flag en `shipments`**: columna `high_demand BOOLEAN NULL` (migración Prisma) junto a `suggested_price_ars` y `calculation_method`, porque se escribe en el mismo momento y con la misma semántica: foto de la cotización al crear el envío, que no se recalcula. `NULL` significa que no hubo cotización ("precio a estimar") o que el envío es anterior a `demand_fuel_routes_v1`. No es lo mismo que `false`, y el mobile solo muestra el badge con `true`. Se expone en el detalle del envío para el emisor, así el badge sigue visible después de crearlo y no solo en la respuesta de la cotización. Queda como AC nuevo de MOVO-138, porque hoy no está en sus criterios.
5. **Si falla `RoutesProvider` en `/quote`: se degrada (decidido).** Si Google falla (caído, timeout o cuota diaria agotada), `/quote` **no** propaga el 502. Calcula la distancia con Haversine × 1,3, cotiza igual y deja `distanceSource: "haversine_fallback"` en el log `pricing_quote_computed` (el prototipo lo demuestra en la sección 5). Es una excepción deliberada y acotada a `/quote` de la política No-Fallback de MOVO-205, que sigue vigente para `/optimize/route` y `/routes/evaluate-candidates`. Ahí una distancia inventada se convierte en instrucciones de ruta falsas para el transportista. Acá es un precio *sugerido* que el emisor puede editar, y quedarse sin precio cada vez que se agota la cuota de Google es peor que un precio unos puntos impreciso. El timeout hacia Google en `/quote` tiene que dejar margen dentro de los 3 s de `pricing-client.ts`: con 1,5 s, el fallback llega a tiempo. `calculationMethod` sigue siendo `demand_fuel_routes_v1`: la fórmula es la misma y solo cambia la fuente de un insumo, igual que cuando el combustible sale del último valor bueno.

## 8. Riesgos y limitaciones aceptadas

- **Precio con distancia aproximada si Google falla.** La línea recta × 1,3 puede errar la distancia real en caminos sinuosos o sin ruta directa. Es aceptable para un precio sugerido y editable, y queda identificado en el log con `distanceSource`.
- **API gubernamental sin SLA y solo HTTP.** Mitigado con los tres niveles de cache y los controles de cordura. En el peor caso se cotiza con el precio de config, nunca se deja de cotizar.
- **Un aumento real mayor a 25% en un día se rechaza.** El control contra el último valor bueno no distingue un dato alterado de una devaluación brusca. Se autocorrige: cuando la clave `:lkg` vence (7 días) solo quedan las cotas absolutas y el valor nuevo entra. Mientras tanto se cotiza con el precio anterior. Si eso preocupa, un admin puede borrar la clave `:lkg` a mano.
- **Umbral calibrado con datos sintéticos.** Es la mejor aproximación disponible sin producción. Los parámetros están en config y el log `pricing_quote_computed` es exactamente el dato que hace falta para recalibrar.
- **Precio nacional y no local.** Como la tarifa entera está en litros, en La Pampa el precio queda ~21% por encima de lo que daría su nafta local y en Misiones ~5% por debajo. En las provincias con más operación el desvío es de ±2%. Aceptado por lo explicado en §3.3. Si el piloto se concentra en una provincia con buena muestra, cambiar a la mediana provincial es solo agregar un `WHERE provincia = …`.
- **La demanda se mide al cotizar.** Si la zona se descongestiona después, el precio del envío no baja solo. El emisor igual negocia con las ofertas (MOVO-102).
- **Posible manipulación del ratio.** Un usuario podría publicar envíos falsos para inflar la demanda, pero solo encarecería su propia cotización. El incentivo contrario, no publicar para no pagar recargo, no existe porque el recargo depende de los envíos ajenos.

## 9. ADR-025

**ADR-025:** el precio de combustible sale de la API CKAN de la Secretaría de Energía (mediana nacional de nafta súper, 30 días de frescura, cache 24h + último valor bueno 7d, degradación permitida), y los coeficientes de la tarifa se expresan en litros de nafta. La demanda la cuenta `svc-shipments` y viaja en el request, lo que preserva ADR-019. Si falla Google, `/quote` degrada la distancia a Haversine × 1,3, como excepción acotada a la política No-Fallback de MOVO-205. El resumen de una línea ya está en la tabla del `CLAUDE.md` raíz y el desarrollo completo va en el Sprint 0 de Drive.

## 10. Cómo correr el prototipo

```bash
python docs/pricing/pricing_prototype.py            # consulta la API real (~1s)
python docs/pricing/pricing_prototype.py --offline  # sin red, con los valores del 24/09/2026
```

Solo usa stdlib (Python 3.10+). Imprime cinco secciones: (1) combustible, con las dos vías de consulta, el cache y la degradación; (2) la tabla de la función de demanda; (3) el conteo de demanda en una zona de ejemplo; (4) la calibración Monte Carlo; y (5) cotizaciones de punta a punta contra v1 y el JSON de respuesta.
