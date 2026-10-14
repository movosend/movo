# MOVO-276 — Grilla de referencia del motor de precios

Calibración del método `package_tapered_v2` (MOVO-276) y base de sus golden tests
(AC1/AC6). Este documento fija **qué** se mide (rutas y paquetes), **contra qué** se
compara (Correo Argentino) y **qué banda** tiene que respetar el motor; muestra los
precios del motor anterior (`demand_fuel_routes_v1` con los tramos de distancia del
hotfix `d2f740c2`) y los del nuevo, con los coeficientes elegidos.

## Cómo se reproduce

La grilla vive en código, en `services/movo-svc-pricing-logistics/tests/pricing_grid.py`
(rutas con coordenadas, perfiles de paquete, referencia de Correo y banda). La tabla de
abajo sale de:

```bash
cd services/movo-svc-pricing-logistics
python -m tests.pricing_grid
```

Condiciones fijas, para que cada celda sea determinística:

- **Origen**: Córdoba capital (-31,4167; -64,1833).
- **Distancia**: mock de rutas (Haversine × 1,3, `distanceSource: haversine_mock`), igual
  que dev/CI. Contra Google la distancia real difiere (ej. Córdoba → Rosario: 487 km en la
  grilla contra ~400 km por ruta), pero lo que se calibra es la forma de la curva, y con
  el mock la grilla no depende de una API paga.
- **Nafta**: 2.222,5 $/l (mediana nacional del spike MOVO-216), fija en la grilla aunque
  se recalibre el fallback de config.
- **Sin recargo por demanda** (`demandContext` ausente).

## Perfiles de paquete

Peso facturable = máx(peso real, L × A × H / 5000), el divisor de referencia de la
industria (`package_tapered_v2` lo usa; `demand_fuel_routes_v1` no lo usaba).

| Perfil | Tipo | Peso real | Medidas (cm) | Peso volumétrico | Peso facturable |
| --- | --- | ---: | --- | ---: | ---: |
| Carta / documento | `letter_document` | 0,2 kg | 30 × 22 × 1 | 0,1 kg | 0,2 kg |
| Caja de zapatos | `standard_package` | 1,5 kg | 35 × 25 × 15 | 2,6 kg | 2,6 kg |
| Caja mediana 5 kg | `standard_package` | 5 kg | 40 × 30 × 30 | 7,2 kg | 7,2 kg |
| TV 43" (liviano, voluminoso) | `standard_package` | 8 kg | 105 × 65 × 15 | 20,5 kg | 20,5 kg |
| Compacto 20 kg | `standard_package` | 20 kg | 40 × 30 × 25 | 6 kg | 20 kg |
| Frágil chico (vajilla) | `fragile_item` | 2 kg | 30 × 30 × 20 | 3,6 kg | 3,6 kg |
| Cubo máximo 100 cm, 10 kg | `standard_package` | 10 kg | 100 × 100 × 100 | 200 kg | 200 kg |

El cubo de 100 cm es el paquete más voluminoso que admiten los límites duros de
MOVO-276 (lado ≤ 150 cm, suma de lados ≤ 300 cm): sirve para verificar que el peso
volumétrico no dispare el precio.

## Referencia de mercado: Correo Argentino

Encomienda Clásica a domicilio, origen CABA, relevada al 10/10/2026
([Zenda Envíos, "Tarifas de Correo Argentino 2026"](https://zendaenvios.com/blog/tarifas-correo-argentino-2026/),
que toma los valores de la API de cotización MiCorreo).

| Zona | Hasta 1 kg | Hasta 5 kg | Hasta 10 kg |
| --- | ---: | ---: | ---: |
| z1 (Rosario, Córdoba, Mar del Plata) | $9.648 | $15.957 | $21.342 |
| z2 (Mendoza, Tucumán, Neuquén) | $10.509 | $17.880 | $25.423 |
| z3 (Salta, Ushuaia) | $10.586 | $19.724 | $30.568 |

A sucursal es ~29% más barato (z1, 1 kg: $6.739). Las tarifas son por zona y origen CABA;
para la grilla se asignó a cada destino desde Córdoba la zona de distancia equivalente
(Río Cuarto, Rosario y CABA → z1; San Juan → z2; Posadas y Puerto Iguazú → z3). Es una
aproximación: el Correo no publica su matriz de zonas por origen.

Dos rasgos del modelo del Correo que importan para MOVO:

- **La distancia casi no mueve el precio**: 1 kg cuesta entre $9.648 y $10.586 de punta a
  punta del país (+10%).
- **El peso sí**: de 1 a 10 kg el precio sube entre $11.700 (z1) y $20.000 (z3), es decir,
  entre ~1.100 y ~2.200 $/kg.

## Banda de referencia (AC1)

> Para `standard_package` en rutas de 200 km o más y peso facturable de hasta 10 kg, el
> precio de MOVO queda **entre 0,6× y 1,0× del Correo clásico a domicilio** del mismo
> tramo de peso y zona.

- **Techo 1,0×**: MOVO no debería costarle al emisor más que un courier puerta a puerta;
  la propuesta de valor P2P es que el viaje ya ocurría.
- **Piso 0,6×**: por debajo, el precio sugerido deja de ser atractivo para el
  transportista (es apenas por encima del Correo a sucursal, 0,7×, donde el emisor
  además se lleva el paquete él mismo).
- **Fuera de la banda**, a propósito:
  - **Documentos**: el Correo cotiza cartas con otro producto (carta documento /
    certificada); para AC3 alcanza con documento < mediano.
  - **Frágil**: el Correo no publica un recargo por frágil; se verifica por relación
    (frágil > el mismo paquete no frágil, AC3).
  - **Peso facturable > 10 kg**: no hay tramos relevados (TV, compacto de 20 kg, cubo).
  - **Rutas cortas (< 200 km)**: el Correo no es la referencia de un envío en la misma
    ciudad; la competencia ahí es la mensajería urbana en moto. Quedan sin banda,
    cubiertas solo por la monotonía (AC2).

## Precios con el motor vigente (v1, antes de MOVO-276)

`demand_fuel_routes_v1` con los tramos del hotfix. Entre paréntesis, el cociente contra el
Correo cuando la celda entra en la banda.

| Ruta | km | Carta / documento | Caja de zapatos | Caja mediana 5 kg | TV 43" (liviano, voluminoso) | Compacto 20 kg | Frágil chico (vajilla) | Cubo máximo 100 cm, 10 kg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Córdoba urbano | 9 | 2.900 | 3.290 | 4.340 | 5.240 | 8.840 | 4.130 | 5.840 |
| Villa Carlos Paz | 39 | 6.360 | 6.750 | 7.800 | 8.700 | 12.300 | 8.280 | 9.300 |
| Río Cuarto | 249 | 12.700 | 13.090 (0.82x) | 14.140 (0.66x) | 15.040 | 18.640 | 15.890 | 15.640 |
| Rosario | 487 | 14.680 | 15.070 (0.94x) | 16.120 (0.76x) | 17.020 | 20.620 | 18.260 | 17.620 |
| San Juan | 537 | 14.790 | 15.180 (0.85x) | 16.230 (0.64x) | 17.130 | 20.730 | 18.400 | 17.730 |
| CABA | 840 | 15.480 | 15.870 (0.99x) | 16.920 (0.79x) | 17.820 | 21.420 | 19.220 | 18.420 |
| Posadas | 1.196 | 16.290 | 16.680 (0.85x) | 17.730 (0.58x) | 18.630 | 22.230 | 20.190 | 19.230 |
| Puerto Iguazú | 1.481 | 16.930 | 17.320 (0.88x) | 18.370 (0.60x) | 19.270 | 22.870 | 20.970 | 19.870 |

### Casos del ticket

- **Córdoba → San Juan**: $15.180 para una caja chica, en línea con la estimación a mano
  del ticket (~$15.000). El valor original ($54.511,52) era previo al hotfix y no se
  pudo reproducir exacto sin el request que lo generó (coordenadas, medidas y distancia
  de Google de ese momento).
- **Córdoba → Misiones**: entre $16.680 (Posadas) y $17.320 (Puerto Iguazú), contra los
  más de $300.000 previos al hotfix.

## Hallazgos

1. **La distancia ya está bien achatada.** Entre Rosario y Puerto Iguazú (3× la distancia)
   el precio sube ~15%, parecido al +10% del Correo entre zonas. Lo que hay que
   calibrar no es la curva de distancia sino lo de abajo.
2. **El peso casi no pesa.** El motor cobra ~300 $/kg (0,135 l) contra 1.100–2.200 $/kg del
   Correo. Por eso la caja de 5 kg cae al borde o debajo de la banda (0,58× en Posadas,
   0,60× en Puerto Iguazú), mientras la caja de zapatos está cerca del techo (0,99× a
   CABA): el precio de MOVO es casi plano en el peso y el del mercado no.
3. **El volumen no existe.** El TV de 105 × 65 × 15 cm cuesta $1.950 más que una caja de
   zapatos, y el cubo de 1 m³ cuesta lo mismo que una caja compacta de 10 kg. Es el
   problema central de la issue.
4. **La carta no se diferencia.** Una carta cuesta $390 menos que una caja de zapatos en
   cualquier ruta (solo por el peso); el factor de `letter_document` es 1,0. A 1.500 km,
   un documento cuesta $16.930.
5. **El primer tramo de distancia pesa mucho en trayectos cortos.** Villa Carlos Paz
   (39 km) cuesta el doble que un envío urbano (9 km), porque los primeros 30 km van al
   100%. Sin referencia de mercado para ese segmento: queda sin banda.

## Calibración de `package_tapered_v2`

Decisiones del equipo: la banda de 0,6× a 1,0× queda confirmada, y las rutas cortas
quedan **sin banda**, cubiertas solo por la monotonía (AC2).

Cambios contra el motor vigente (coeficientes en litros de nafta, a 2.222,5 $/l):

| Parámetro | v1 | v2 | En pesos (v2) |
| --- | ---: | ---: | ---: |
| Base de paquete (`PRICING_BASE_FARE_L`) | 0,675 l | 0,15 l | $333 |
| Base de documento (`PRICING_BASE_FARE_DOCUMENT_L`) | igual a la de paquete | 0 l | $0 |
| Por kg (`PRICING_PER_KG_L`) | 0,135 l por kg real | 0,275 l por kg facturable | $611/kg |
| Divisor volumétrico (`PRICING_VOLUMETRIC_DIVISOR`) | — | 5000 | — |
| Tramo de peso (`PRICING_WEIGHT_TIER_KG` / `_RATE`) | — | primeros 10 kg al 100%, el resto al 35% | $214/kg desde el kg 11 |
| Frágil (`PRICING_FRAGILE_SURCHARGE`) | factor 1,2 | +20% | — |
| Tramos de distancia | sin cambios | sin cambios | $151/km los primeros 30 km |

La combinación de base y tarifa por kg se eligió con una búsqueda sobre la grilla: entre
las que dejan todas las celdas dentro de la banda, una de las de menor desvío respecto
de 0,8×, con una base de paquete mayor que cero. El **tramo de peso** no estaba en el
plan original: sin él, el cubo de 1 m³ (200 kg volumétricos, el máximo que admiten los
límites) cotizaba ~$135.000 a cualquier destino. No afecta la banda, que llega hasta
10 kg facturables, y se desactiva con `PRICING_WEIGHT_TIER_RATE=1`.

### Precios con `package_tapered_v2`

| Ruta | km | Carta / documento | Caja de zapatos | Caja mediana 5 kg | TV 43" (liviano, voluminoso) | Compacto 20 kg | Frágil chico (vajilla) | Cubo máximo 100 cm, 10 kg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Córdoba urbano | 9 | 1.460 | 3.280 | 6.080 | 10.030 | 9.930 | 4.650 | 48.430 |
| Villa Carlos Paz | 39 | 4.920 | 6.740 | 9.530 | 13.490 | 13.380 | 8.800 | 51.890 |
| Río Cuarto | 249 | 11.260 | 13.080 (0.82x) | 15.880 (0.74x) | 19.830 | 19.730 | 16.410 | 58.230 |
| Rosario | 487 | 13.240 | 15.060 (0.94x) | 17.850 (0.84x) | 21.800 | 21.700 | 18.780 | 60.210 |
| San Juan | 537 | 13.350 | 15.170 (0.85x) | 17.970 (0.71x) | 21.920 | 21.820 | 18.920 | 60.320 |
| CABA | 840 | 14.040 | 15.860 (0.99x) | 18.650 (0.87x) | 22.610 | 22.500 | 19.740 | 61.010 |
| Posadas | 1.196 | 14.850 | 16.660 (0.84x) | 19.460 (0.64x) | 23.410 | 23.310 | 20.710 | 61.820 |
| Puerto Iguazú | 1.481 | 15.490 | 17.310 (0.88x) | 20.110 (0.66x) | 24.060 | 23.960 | 21.490 | 62.460 |

Las 12 celdas con referencia quedan entre 0,64× y 0,99× (AC1). Estos valores son los
golden tests de `tests/test_pricing_golden.py`.

### Limitaciones que quedan

- **La caja de zapatos a CABA queda en 0,99×, al borde del techo.** La distancia del mock
  a CABA (840 km) es mayor que la real (~700 km), así que con Google el cociente baja;
  aun así el margen es chico, y cualquier recalibración tiene que volver a pasar la banda.
- **Un documento a larga distancia sigue siendo caro** ($15.490 a Puerto Iguazú, más que
  1 kg por Correo). El precio de un documento es casi todo distancia, y una base menor no
  alcanza para corregirlo. Bajar la tarifa por km solo para documentos sería otro
  parámetro por categoría; queda como candidato a recalibrar con datos reales.
- **El cubo de 1 m³ cuesta 3 a 8 veces más que la caja de 5 kg** (~$48.000 a ~$62.000).
  Es el paquete más grande que se acepta y ocupa un baúl entero, así que se considera
  razonable, pero no hay referencia de mercado para validarlo.
