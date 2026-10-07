#!/usr/bin/env python3
"""
MOVO-216: Prototipo del motor de precios dinámico (`demand_fuel_routes_v1`).

Valida empíricamente las tres piezas del spike:

1. Precio de referencia del combustible desde la API CKAN de la Secretaría de Energía
   (dataset "Precios en surtidor - Resolución 314/2016"), con filtro de frescura,
   controles de cordura y cache de dos niveles (fresco 24h / último valor bueno 7d).
2. Función de recargo por alta demanda a partir de la relación envíos publicados /
   transportistas disponibles en la zona del retiro, con umbral y tope.
3. Contrato simplificado de `POST /quote`: el emisor recibe solo
   `suggestedPriceArs` + `highDemand` + `calculationMethod`; el desglose queda en el log.

Sin dependencias externas (solo stdlib), para que cualquiera del equipo lo corra:

    python docs/pricing/pricing_prototype.py            # consulta la API real
    python docs/pricing/pricing_prototype.py --offline  # usa los valores relevados el 24/09/2026

Documentación: docs/pricing/pricing-spike-report.md
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import random
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("pricing")

# ============================================================================
# 1. PRECIO DE COMBUSTIBLE (API CKAN, Secretaría de Energía)
# ============================================================================

# Solo HTTP: el endpoint HTTPS responde 301 a HTTP (relevado el 24/09/2026). Sin TLS,
# un intermediario podría alterar la respuesta; los controles de cordura de
# `FuelPriceService` limitan el daño posible.
CKAN_BASE_URL = "http://datos.energia.gob.ar/api/3/action"
# Recurso "Precios vigentes en surtidor - Resolución 314/2016" (se actualiza a diario).
RESOURCE_ID = "80ac25de-a44a-4445-9215-090cf55cfda5"

PRODUCT_NAFTA_SUPER = 2  # "Nafta (súper) entre 92 y 95 Ron"
PRODUCT_GASOIL_G2 = 19  # "Gas Oil Grado 2"
HORARIO_DIURNO = 2  # cada estación declara diurno y nocturno; casi siempre coinciden

FRESHNESS_DAYS = 30  # declaraciones más viejas se descartan (ver informe, sección 3.3)
MIN_SAMPLES = 50  # por debajo, la mediana no se considera representativa
SANE_MIN_ARS_PER_L = 500.0  # cotas absolutas contra datos corruptos / respuesta alterada
SANE_MAX_ARS_PER_L = 10_000.0
MAX_DAILY_CHANGE = 0.25  # un salto >25% contra el último valor bueno se rechaza

# Valores relevados el 24/09/2026 (modo --offline y ejemplo del informe).
OFFLINE_FUEL_PRICE_ARS_PER_L = 2222.5  # mediana nacional nafta súper, 620 muestras frescas


class FuelPriceUnavailable(Exception):
    pass


def _http_get_json(url: str, timeout_s: float = 2.0) -> dict:  # < 3s de pricing-client.ts
    with urllib.request.urlopen(url, timeout=timeout_s) as resp:  # noqa: S310 (URL fija)
        return json.loads(resp.read().decode("utf-8"))


def fetch_median_via_sql(product_id: int) -> tuple[float, int]:
    """Vía primaria: la mediana se calcula en el servidor (una sola fila de respuesta,
    ~0,1-0,5s medidos). Filtra por producto, horario diurno y frescura."""
    sql = (
        "SELECT COUNT(*) AS n, "
        "percentile_cont(0.5) WITHIN GROUP (ORDER BY precio) AS mediana "
        f'FROM "{RESOURCE_ID}" '
        f"WHERE idproducto = {int(product_id)} AND idtipohorario = {HORARIO_DIURNO} "
        f"AND fecha_vigencia >= NOW() - INTERVAL '{FRESHNESS_DAYS} days'"
    )
    url = f"{CKAN_BASE_URL}/datastore_search_sql?sql={urllib.parse.quote(sql)}"
    data = _http_get_json(url)
    if not data.get("success"):
        raise FuelPriceUnavailable(f"datastore_search_sql sin éxito: {data.get('error')}")
    row = data["result"]["records"][0]
    if row["mediana"] is None:
        raise FuelPriceUnavailable("sin muestras frescas")
    return float(row["mediana"]), int(row["n"])


def fetch_median_via_search(product_id: int) -> tuple[float, int]:
    """Vía alternativa si el portal deshabilita el endpoint SQL (algunos CKAN lo
    apagan): trae todas las filas del producto (~4.200, ~360KB) y filtra/agrega
    localmente."""
    params = urllib.parse.urlencode(
        {
            "resource_id": RESOURCE_ID,
            "filters": json.dumps({"idproducto": product_id, "idtipohorario": HORARIO_DIURNO}),
            "fields": "precio,fecha_vigencia",
            "limit": 10_000,
        }
    )
    data = _http_get_json(f"{CKAN_BASE_URL}/datastore_search?{params}", timeout_s=10.0)
    cutoff = (datetime.now() - timedelta(days=FRESHNESS_DAYS)).isoformat()
    prices = [float(r["precio"]) for r in data["result"]["records"] if r["fecha_vigencia"] >= cutoff]
    if not prices:
        raise FuelPriceUnavailable("sin muestras frescas")
    return statistics.median(prices), len(prices)


@dataclass
class CachedFuelPrice:
    ars_per_liter: float
    samples: int
    fetched_at: float
    source: str


@dataclass
class FuelPriceService:
    """Emula lo que en el servicio real serían dos claves de Redis:

    - `fuel_price:{product}`      TTL 24h -> valor "fresco"; mientras exista, 0 llamadas.
    - `fuel_price:{product}:lkg`  TTL 7d  -> último valor bueno ("last known good").

    Si la API falla o devuelve algo inverosímil, se usa el LKG. Si tampoco hay LKG,
    se usa el valor de configuración (`PRICING_FUEL_PRICE_FALLBACK_ARS_PER_L`). A
    diferencia de la política No-Fallback del ruteo (MOVO-205), acá degradar es
    correcto: el precio de ayer es una aproximación excelente del de hoy, y fallar
    la cotización deja al envío en "precio a estimar".
    """

    fetcher: callable  # type: ignore[valid-type]
    fallback_ars_per_liter: float
    fresh_ttl_s: float = 24 * 3600
    lkg_ttl_s: float = 7 * 24 * 3600
    fresh: CachedFuelPrice | None = None
    lkg: CachedFuelPrice | None = None
    upstream_calls: int = 0

    def _is_sane(self, value: float, samples: int) -> bool:
        if samples < MIN_SAMPLES or not (SANE_MIN_ARS_PER_L <= value <= SANE_MAX_ARS_PER_L):
            return False
        if self.lkg and abs(value / self.lkg.ars_per_liter - 1) > MAX_DAILY_CHANGE:
            return False
        return True

    def get(self, product_id: int = PRODUCT_NAFTA_SUPER, now: float | None = None) -> CachedFuelPrice:
        now = time.time() if now is None else now
        if self.fresh and now - self.fresh.fetched_at < self.fresh_ttl_s:
            return self.fresh
        try:
            self.upstream_calls += 1
            value, samples = self.fetcher(product_id)
            if self._is_sane(value, samples):
                self.fresh = self.lkg = CachedFuelPrice(value, samples, now, "api")
                return self.fresh
            log.warning("fuel_price_rejected value=%s samples=%s", value, samples)
        except Exception as exc:  # noqa: BLE001 — cualquier falla degrada igual
            log.warning("fuel_price_fetch_failed error=%s", exc)
        if self.lkg and now - self.lkg.fetched_at < self.lkg_ttl_s:
            return CachedFuelPrice(self.lkg.ars_per_liter, self.lkg.samples, self.lkg.fetched_at, "lkg")
        return CachedFuelPrice(self.fallback_ars_per_liter, 0, now, "config")


# ============================================================================
# 2. DEMANDA EN LA ZONA
# ============================================================================

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def point_to_segment_km(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """Mismo prefiltro de corredor que MOVO-50 (proyección equirectangular local)."""
    k_lat = 111.32
    k_lng = 111.32 * math.cos(math.radians(a[0]))
    px, py = (p[1] - a[1]) * k_lng, (p[0] - a[0]) * k_lat
    bx, by = (b[1] - a[1]) * k_lng, (b[0] - a[0]) * k_lat
    seg2 = bx * bx + by * by
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, (px * bx + py * by) / seg2))
    return math.hypot(px - t * bx, py - t * by)


ZONE_RADIUS_KM = 15.0  # mismo umbral que el prefiltro de corredor de MOVO-50
TRIP_HORIZON_H = 72  # viajes que salen en las próximas 72h cuentan como oferta
TRIP_LOOKBACK_H = 6  # ... o que salieron hace poco (siguen en ruta)


@dataclass
class OpenShipment:  # status = published
    pickup: tuple[float, float]


@dataclass
class DeclaredTrip:  # status in (declared, active)
    carrier_id: str
    origin: tuple[float, float]
    destination: tuple[float, float]
    departure_at: datetime


@dataclass
class DemandContext:
    """Lo que `movo-svc-shipments` le mandaría a `POST /quote` (ver informe, 4.3).
    Son dos enteros: `movo-svc-pricing-logistics` sigue sin base de datos (ADR-019)."""

    published_shipments: int
    available_carriers: int


def count_zone_demand(
    pickup: tuple[float, float],
    shipments: list[OpenShipment],
    trips: list[DeclaredTrip],
    now: datetime,
) -> DemandContext:
    """Equivalente en memoria de las dos consultas que haría svc-shipments (bounding box
    + Haversine, mismo patrón que `GET /shipments/available`, MOVO-142)."""
    published = sum(1 for s in shipments if haversine_km(*pickup, *s.pickup) <= ZONE_RADIUS_KM)
    lo, hi = now - timedelta(hours=TRIP_LOOKBACK_H), now + timedelta(hours=TRIP_HORIZON_H)
    carriers = {
        t.carrier_id
        for t in trips
        if lo <= t.departure_at <= hi and point_to_segment_km(pickup, t.origin, t.destination) <= ZONE_RADIUS_KM
    }
    return DemandContext(published_shipments=published, available_carriers=len(carriers))


# Parámetros de la función de recargo (en el servicio real, `PRICING_DEMAND_*`).
DEMAND_RATIO_THRESHOLD = 3.0  # >= 3 paquetes por transportista disponible (calibrado en demo_simulation)
DEMAND_MIN_SHIPMENTS = 4  # evita marcar zonas casi vacías (1-2 envíos vs 0 transportistas)
DEMAND_BASE_SURCHARGE = 0.10  # recargo al cruzar el umbral
DEMAND_SLOPE = 0.05  # +5% por cada punto de ratio por encima del umbral
DEMAND_MAX_SURCHARGE = 0.30  # tope duro


@dataclass
class DemandResult:
    ratio: float
    high_demand: bool
    multiplier: float


def demand_multiplier(ctx: DemandContext) -> DemandResult:
    """demand = envíos publicados en la zona + 1 (el que se está cotizando);
    ratio = demand / max(transportistas, 1).

    Alta demanda <=> demand >= MIN y ratio >= UMBRAL. El badge y el recargo van
    siempre juntos: `highDemand: true` si y solo si el multiplicador es > 1, así el
    emisor nunca ve un recargo sin la explicación ni un badge sin efecto.
    """
    demand = ctx.published_shipments + 1
    ratio = demand / max(ctx.available_carriers, 1)
    if demand < DEMAND_MIN_SHIPMENTS or ratio < DEMAND_RATIO_THRESHOLD:
        return DemandResult(ratio, False, 1.0)
    surcharge = min(DEMAND_MAX_SURCHARGE, DEMAND_BASE_SURCHARGE + DEMAND_SLOPE * (ratio - DEMAND_RATIO_THRESHOLD))
    return DemandResult(ratio, True, round(1.0 + surcharge, 4))


# ============================================================================
# 3. FÓRMULA demand_fuel_routes_v1 Y CONTRATO
# ============================================================================

# Coeficientes expresados en LITROS de nafta, no en pesos: se indexan solos con el
# precio del surtidor (ver informe, 5.2). Calibrados para que, al precio del 24/09/2026
# (2.222,5 ARS/l), la tarifa quede cerca de euclidean_linear_v1 (1500 base, 150/km,
# 300/kg) y el cambio de método no sea un salto de precio para los usuarios.
BASE_FARE_L = 0.675  # ~1.500 ARS
FUEL_L_PER_KM = 0.08  # consumo de un auto mediano (8 l/100km)
FUEL_COST_SHARE = 0.6  # parte del combustible del trayecto que paga el emisor (P2P: el viaje ya ocurría)
NON_FUEL_L_PER_KM = 0.02  # desgaste/peajes/tiempo, ~44 ARS/km
PER_KG_L = 0.135  # ~300 ARS/kg
PACKAGE_FACTORS = {"letter_document": 1.0, "standard_package": 1.0, "fragile_item": 1.2}
ROAD_DETOUR_FACTOR = 1.3  # línea recta -> ruta: mock de RoutesProvider y fallback si Google falla


@dataclass
class QuoteInput:
    origin: tuple[float, float]
    destination: tuple[float, float]
    weight_kg: float
    package_type: str
    demand: DemandContext


@dataclass
class QuoteOutput:
    suggested_price_ars: float
    high_demand: bool
    calculation_method: str = "demand_fuel_routes_v1"
    breakdown: dict = field(default_factory=dict)  # solo para log/auditoría, NO viaja

    def to_wire(self) -> dict:
        """Contrato de `POST /quote` que ve el consumidor (sección 6 del informe)."""
        return {
            "suggestedPriceArs": self.suggested_price_ars,
            "highDemand": self.high_demand,
            "calculationMethod": self.calculation_method,
        }


def haversine_road_km(origin: tuple[float, float], destination: tuple[float, float]) -> float:
    return haversine_km(*origin, *destination) * ROAD_DETOUR_FACTOR


def simulated_routes_api_km(origin: tuple[float, float], destination: tuple[float, float]) -> float:
    """Stand-in de `RoutesProvider` (ADR-015, matriz 1x1). El prototipo no llama a Google:
    devuelve la misma aproximación que el fallback, alcanza para comparar escenarios."""
    return haversine_road_km(origin, destination)


def road_distance_km(
    origin: tuple[float, float],
    destination: tuple[float, float],
    routes_fn=simulated_routes_api_km,  # noqa: ANN001
) -> tuple[float, str]:
    """Decisión de la spike (informe §7.5): si Google falla (caído, timeout, cuota diaria
    agotada), `/quote` NO propaga el 502 — degrada a Haversine x 1,3 y lo deja en el log
    (`distanceSource`). A diferencia de `/optimize/route` (No-Fallback, MOVO-205), acá el
    resultado es un precio sugerido que el emisor puede editar, no instrucciones de ruta."""
    try:
        return routes_fn(origin, destination), "routes_api"
    except Exception as exc:  # noqa: BLE001 — cualquier falla del proveedor degrada igual
        log.warning("routes_provider_failed_using_haversine error=%s", exc)
        return haversine_road_km(origin, destination), "haversine_fallback"


def compute_quote(req: QuoteInput, fuel: CachedFuelPrice, routes_fn=simulated_routes_api_km) -> QuoteOutput:  # noqa: ANN001
    p = fuel.ars_per_liter
    distance_km, distance_source = road_distance_km(req.origin, req.destination, routes_fn)

    base = BASE_FARE_L * p
    per_km_ars = (FUEL_L_PER_KM * FUEL_COST_SHARE + NON_FUEL_L_PER_KM) * p
    distance_component = distance_km * per_km_ars
    weight_component = req.weight_kg * PER_KG_L * p
    subtotal = (base + distance_component + weight_component) * PACKAGE_FACTORS[req.package_type]

    demand = demand_multiplier(req.demand)
    price = round(subtotal * demand.multiplier, -1)  # redondeo a $10: precio "de góndola"

    breakdown = {
        "fuelArsPerLiter": p,
        "fuelSource": fuel.source,
        "distanceKm": round(distance_km, 2),
        "distanceSource": distance_source,
        "perKmArs": round(per_km_ars, 2),
        "base": round(base, 2),
        "distance": round(distance_component, 2),
        "weight": round(weight_component, 2),
        "packageFactor": PACKAGE_FACTORS[req.package_type],
        "demandRatio": round(demand.ratio, 2),
        "demandMultiplier": demand.multiplier,
    }
    out = QuoteOutput(price, demand.high_demand, breakdown=breakdown)
    log.info("pricing_quote_computed %s", json.dumps({**out.to_wire(), "breakdown": breakdown}))
    return out


def legacy_euclidean_linear_v1(req: QuoteInput, distance_factor: float = 1.0) -> float:
    """Réplica de app/services/pricing.py (MOVO-82) para comparar."""
    lat_km = (req.destination[0] - req.origin[0]) * 111.32
    lng_km = (req.destination[1] - req.origin[1]) * 111.32 * math.cos(math.radians((req.origin[0] + req.destination[0]) / 2))
    d = math.hypot(lat_km, lng_km) * distance_factor
    return round((1500 + d * 150 + req.weight_kg * 300) * PACKAGE_FACTORS[req.package_type], 2)


# ============================================================================
# 4. ESCENARIOS / DEMO
# ============================================================================

CORDOBA = (-31.4167, -64.1833)
VILLA_MARIA = (-32.4075, -63.2403)
CARLOS_PAZ = (-31.4241, -64.4978)
NUEVA_CBA = (-31.4290, -64.1880)
CERRO = (-31.3770, -64.2330)
RIO_CUARTO = (-33.1232, -64.3493)


def section(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def demo_fuel(offline: bool) -> FuelPriceService:
    section("1. Precio de combustible (Secretaría de Energía, Res. 314/2016)")
    if offline:
        fetcher = lambda _pid: (OFFLINE_FUEL_PRICE_ARS_PER_L, 620)  # noqa: E731
    else:
        fetcher = fetch_median_via_sql
        for name, fn in (("SQL (primaria)", fetch_median_via_sql), ("search (alternativa)", fetch_median_via_search)):
            try:
                t0 = time.perf_counter()
                value, n = fn(PRODUCT_NAFTA_SUPER)
                print(f"  vía {name:<22} mediana nafta súper = {value:>8.1f} ARS/l  n={n:<5} {1000 * (time.perf_counter() - t0):6.0f} ms")
            except Exception as exc:  # noqa: BLE001
                print(f"  vía {name:<22} FALLÓ: {exc}")

    svc = FuelPriceService(fetcher=fetcher, fallback_ars_per_liter=OFFLINE_FUEL_PRICE_ARS_PER_L)
    t = 1_000_000.0
    first = svc.get(now=t)
    for i in range(1, 1000):  # 1.000 cotizaciones en 23h -> una sola llamada a la API
        svc.get(now=t + i * 80)
    print(f"  cache: 1.000 cotizaciones en 23h -> {svc.upstream_calls} llamada(s) a la API ({first.ars_per_liter} ARS/l, fuente={first.source})")

    # Controles de cordura y degradación.
    def broken(_pid: int) -> tuple[float, int]:
        raise TimeoutError("timeout simulado")

    svc.fetcher = broken
    r = svc.get(now=t + 25 * 3600)
    print(f"  API caída a las 25h        -> {r.ars_per_liter} ARS/l, fuente={r.source}")
    svc.fetcher = lambda _pid: (20.85, 900)  # outlier real visto en el dataset
    svc.fresh = None
    r = svc.get(now=t + 26 * 3600)
    print(f"  API devuelve 20,85 ARS/l   -> {r.ars_per_liter} ARS/l, fuente={r.source} (rechazado)")
    r = svc.get(now=t + 8 * 24 * 3600)
    print(f"  API caída 8 días           -> {r.ars_per_liter} ARS/l, fuente={r.source}")
    svc.fetcher = fetcher
    svc.fresh = None
    svc.lkg = None
    return svc


def demo_demand_function() -> None:
    section("2. Función de recargo por alta demanda")
    print(f"  umbral ratio={DEMAND_RATIO_THRESHOLD}, mínimo envíos={DEMAND_MIN_SHIPMENTS}, "
          f"recargo base={DEMAND_BASE_SURCHARGE:.0%}, pendiente={DEMAND_SLOPE:.0%}/punto, tope={DEMAND_MAX_SURCHARGE:.0%}\n")
    print(f"  {'publicados':>10} {'transp.':>8} {'ratio':>6} {'alta dem.':>10} {'mult.':>7}")
    for s, c in [(0, 0), (2, 0), (3, 0), (3, 5), (5, 2), (8, 3), (8, 2), (11, 2), (13, 2), (20, 1), (40, 10)]:
        d = demand_multiplier(DemandContext(s, c))
        print(f"  {s:>10} {c:>8} {d.ratio:>6.2f} {str(d.high_demand):>10} {d.multiplier:>7.2f}")


def demo_zone_counting() -> None:
    section("3. Conteo de demanda en la zona del retiro (radio 15 km, horizonte 72h)")
    now = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    shipments = [OpenShipment(NUEVA_CBA), OpenShipment(CERRO), OpenShipment(CORDOBA), OpenShipment(CARLOS_PAZ)]
    trips = [
        DeclaredTrip("c1", CORDOBA, VILLA_MARIA, now + timedelta(hours=5)),  # cuenta
        DeclaredTrip("c1", CORDOBA, VILLA_MARIA, now + timedelta(hours=30)),  # mismo transportista: cuenta 1 vez
        DeclaredTrip("c2", CARLOS_PAZ, CORDOBA, now + timedelta(hours=10)),  # termina en la zona: cuenta
        DeclaredTrip("c3", CORDOBA, RIO_CUARTO, now + timedelta(hours=100)),  # fuera de horizonte
        DeclaredTrip("c4", VILLA_MARIA, RIO_CUARTO, now + timedelta(hours=2)),  # lejos del retiro
    ]
    ctx = count_zone_demand(CORDOBA, shipments, trips, now)
    print(f"  retiro en Córdoba centro -> publicados={ctx.published_shipments} (Carlos Paz queda afuera, "
          f"~30 km), transportistas={ctx.available_carriers} (c1 una sola vez + c2)")
    print(f"  -> {demand_multiplier(ctx)}")
    trips = [t for t in trips if t.carrier_id != "c2"]  # c2 cancela su viaje
    ctx = count_zone_demand(CORDOBA, shipments, trips, now)
    print(f"  si c2 cancela             -> publicados={ctx.published_shipments}, transportistas={ctx.available_carriers}")
    print(f"  -> {demand_multiplier(ctx)}")


def demo_simulation(seed: int = 216) -> None:
    section("4. Calibración del umbral (Monte Carlo: 10.000 zonas sintéticas por mercado)")
    # Sin datos de producción todavía: por zona, envíos publicados ~ Poisson(λs) y
    # transportistas ~ Poisson(λc), con λ variando entre zonas (lognormal, σ=0.6).
    # Criterio buscado: badge excepcional con oferta holgada (<10%), minoritario en
    # equilibrio (~20%) y frecuente cuando faltan transportistas (>40%).
    rng = random.Random(seed)

    def poisson(lam: float) -> int:
        limit, k, p = math.exp(-lam), 0, 1.0
        while True:
            p *= rng.random()
            if p <= limit:
                return k
            k += 1

    markets = {"holgado (λs=2, λc=4)": (2, 4), "equilibrado (λs=3, λc=3)": (3, 3), "escaso (λs=4, λc=1.5)": (4, 1.5)}
    candidates = [(2.0, 3), (2.5, 3), (3.0, 3), (3.0, 4), (3.0, 5)]

    global DEMAND_RATIO_THRESHOLD, DEMAND_MIN_SHIPMENTS
    original = (DEMAND_RATIO_THRESHOLD, DEMAND_MIN_SHIPMENTS)
    header = " ".join(f"{f'{t}/{m}':>9}" for t, m in candidates)
    print("  % de zonas con badge para cada umbral/mínimo:")
    print(f"  {'mercado':<26} {header}")
    for name, (ls, lc) in markets.items():
        zones = [
            DemandContext(poisson(rng.lognormvariate(math.log(ls), 0.6)), poisson(rng.lognormvariate(math.log(lc), 0.6)))
            for _ in range(10_000)
        ]
        cells = []
        for thr, mn in candidates:
            DEMAND_RATIO_THRESHOLD, DEMAND_MIN_SHIPMENTS = thr, mn
            flagged = sum(demand_multiplier(z).high_demand for z in zones)
            cells.append(f"{100 * flagged / len(zones):>8.1f}%")
        print(f"  {name:<26} {' '.join(cells)}")
    DEMAND_RATIO_THRESHOLD, DEMAND_MIN_SHIPMENTS = original
    print(f"  -> elegido {DEMAND_RATIO_THRESHOLD}/{DEMAND_MIN_SHIPMENTS}")


def demo_quotes(fuel_svc: FuelPriceService) -> None:
    section("5. Cotizaciones de punta a punta y contrato de respuesta")
    fuel = fuel_svc.get()
    cases = [
        ("Córdoba -> Villa María, 3kg, zona tranquila", CORDOBA, VILLA_MARIA, 3, "standard_package", DemandContext(2, 4)),
        ("Córdoba -> Villa María, 3kg, alta demanda", CORDOBA, VILLA_MARIA, 3, "standard_package", DemandContext(9, 2)),
        ("Nueva Cba -> Cerro (urbano), sobre", NUEVA_CBA, CERRO, 0.2, "letter_document", DemandContext(1, 3)),
        ("Córdoba -> Carlos Paz, frágil 5kg", CORDOBA, CARLOS_PAZ, 5, "fragile_item", DemandContext(12, 1)),
    ]
    print(f"  combustible: {fuel.ars_per_liter} ARS/l (fuente={fuel.source})\n")
    logging.getLogger("pricing").setLevel(logging.WARNING)  # el log de cada quote ensucia la tabla
    # "v1 x vial" = euclidean_linear_v1 con la misma distancia vial que usa el método
    # nuevo: aísla el efecto de tarifa+demanda del efecto de pasar de línea recta a ruta.
    print(f"  {'caso':<44} {'v1 lineal':>10} {'v1 x vial':>10} {'nuevo':>9} {'vs vial':>8}  badge")
    for name, o, d, kg, pt, dem in cases:
        req = QuoteInput(o, d, kg, pt, dem)
        new = compute_quote(req, fuel)
        old = legacy_euclidean_linear_v1(req)
        old_road = legacy_euclidean_linear_v1(req, ROAD_DETOUR_FACTOR)
        diff = 100 * (new.suggested_price_ars / old_road - 1)
        print(f"  {name:<44} {old:>10.0f} {old_road:>10.0f} {new.suggested_price_ars:>9.0f} {diff:>7.0f}%  {new.high_demand}")
    logging.getLogger("pricing").setLevel(logging.INFO)

    print("\n  Respuesta de POST /quote (lo único que ve el consumidor):")
    out = compute_quote(QuoteInput(CORDOBA, VILLA_MARIA, 3, "standard_package", DemandContext(9, 2)), fuel)
    print("  " + json.dumps(out.to_wire(), ensure_ascii=False))

    print("\n  Google Routes API caída (cuota agotada): la cotización sale igual, degradada:")

    def quota_exhausted(*_args: object) -> float:
        raise RuntimeError("429 RESOURCE_EXHAUSTED (simulado)")

    logging.getLogger("pricing").setLevel(logging.ERROR)
    req = QuoteInput(CORDOBA, VILLA_MARIA, 3, "standard_package", DemandContext(2, 4))
    degraded = compute_quote(req, fuel, quota_exhausted)
    logging.getLogger("pricing").setLevel(logging.INFO)
    print(f"  {json.dumps(degraded.to_wire(), ensure_ascii=False)}  distanceSource={degraded.breakdown['distanceSource']}")

    print("\n  Indexación: mismo envío si la nafta sube 20% (sin tocar ninguna config):")
    bumped = CachedFuelPrice(fuel.ars_per_liter * 1.2, 0, 0, "simulado")
    logging.getLogger("pricing").setLevel(logging.WARNING)
    a = compute_quote(QuoteInput(CORDOBA, VILLA_MARIA, 3, "standard_package", DemandContext(2, 4)), fuel)
    b = compute_quote(QuoteInput(CORDOBA, VILLA_MARIA, 3, "standard_package", DemandContext(2, 4)), bumped)
    print(f"  {a.suggested_price_ars:.0f} -> {b.suggested_price_ars:.0f} ARS ({100 * (b.suggested_price_ars / a.suggested_price_ars - 1):.0f}%)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--offline", action="store_true", help="no consulta la API (usa valores relevados)")
    args = parser.parse_args()

    fuel_svc = demo_fuel(args.offline)
    demo_demand_function()
    demo_zone_counting()
    demo_simulation()
    demo_quotes(fuel_svc)


if __name__ == "__main__":
    main()
