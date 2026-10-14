"""Grilla de referencia del motor de precios (MOVO-276, fase 1).

Rutas desde Córdoba capital por perfiles de paquete, con nafta fija y el mock de rutas
(Haversine x 1,3), así cada celda es determinística y reproducible sin Google ni Redis.
La usan los golden tests del motor; el criterio de la banda y el análisis de los
resultados están en `docs/pricing/grilla-referencia.md`.

Para regenerar la tabla del documento:
    python -m tests.pricing_grid
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Literal

from app.models.quote import PackageType, QuoteRequest, QuoteResponse
from app.services.fuel_price import FuelPrice, FuelPriceProvider
from app.services.pricing import compute_quote
from app.services.routes_provider import MockRoutesProvider

# Mismo valor que `fuel_price_fallback_ars_per_l` (mediana nacional del spike MOVO-216):
# fijo acá para que la grilla no cambie si se recalibra el fallback.
GRID_FUEL_ARS_PER_L = 2222.5

CORDOBA = (-31.4167, -64.1833)

CorreoZone = Literal["z1", "z2", "z3"]


@dataclass(frozen=True)
class GridRoute:
    key: str
    label: str
    lat: float
    lng: float
    # Zona aproximada de Correo Argentino para comparar; `None` = sin producto
    # comparable (tramos urbanos y cortos).
    correo_zone: CorreoZone | None


@dataclass(frozen=True)
class GridPackage:
    key: str
    label: str
    package_type: PackageType
    weight_kg: float
    length_cm: float
    width_cm: float
    height_cm: float


ROUTES: tuple[GridRoute, ...] = (
    GridRoute("urbano", "Córdoba urbano", -31.3700, -64.2300, None),
    GridRoute("carlos_paz", "Villa Carlos Paz", -31.4241, -64.4978, None),
    GridRoute("rio_cuarto", "Río Cuarto", -33.1307, -64.3499, "z1"),
    GridRoute("rosario", "Rosario", -32.9468, -60.6393, "z1"),
    GridRoute("san_juan", "San Juan", -31.5375, -68.5364, "z2"),
    GridRoute("caba", "CABA", -34.6037, -58.3816, "z1"),
    GridRoute("posadas", "Posadas", -27.3671, -55.8961, "z3"),
    GridRoute("puerto_iguazu", "Puerto Iguazú", -25.5972, -54.5786, "z3"),
)

PACKAGES: tuple[GridPackage, ...] = (
    GridPackage("carta", "Carta / documento", PackageType.LETTER_DOCUMENT, 0.2, 30, 22, 1),
    GridPackage("zapatos", "Caja de zapatos", PackageType.STANDARD_PACKAGE, 1.5, 35, 25, 15),
    GridPackage("caja_5kg", "Caja mediana 5 kg", PackageType.STANDARD_PACKAGE, 5, 40, 30, 30),
    GridPackage("tv_liviano", "TV 43\" (liviano, voluminoso)", PackageType.STANDARD_PACKAGE, 8, 105, 65, 15),
    GridPackage("pesado_20kg", "Compacto 20 kg", PackageType.STANDARD_PACKAGE, 20, 40, 30, 25),
    GridPackage("fragil_chico", "Frágil chico (vajilla)", PackageType.FRAGILE_ITEM, 2, 30, 30, 20),
    GridPackage("cubo_max", "Cubo máximo 100 cm, 10 kg", PackageType.STANDARD_PACKAGE, 10, 100, 100, 100),
)

# Correo Argentino, Encomienda Clásica a domicilio, origen CABA, relevado el 10/10/2026
# (fuente en `docs/pricing/grilla-referencia.md`). Clave: tope del tramo de peso en kg.
# z1 = Rosario/Córdoba/Mar del Plata, z2 = Mendoza/Tucumán/Neuquén, z3 = Salta/Ushuaia.
CORREO_HOME_DELIVERY_ARS: dict[CorreoZone, dict[float, float]] = {
    "z1": {1: 9648, 5: 15957, 10: 21342},
    "z2": {1: 10509, 5: 17880, 10: 25423},
    "z3": {1: 10586, 5: 19724, 10: 30568},
}

# Banda propuesta para AC1 (a validar con el equipo): MOVO entre 0,6x y 1,0x del Correo
# clásico a domicilio para el mismo tramo de peso facturable.
BAND_MIN_RATIO = 0.6
BAND_MAX_RATIO = 1.0
# Divisor volumétrico de referencia de la industria (Correo/Andreani/OCA).
REFERENCE_VOLUMETRIC_DIVISOR = 5000


def billable_weight_kg(pkg: GridPackage, divisor: float = REFERENCE_VOLUMETRIC_DIVISOR) -> float:
    return max(pkg.weight_kg, pkg.length_cm * pkg.width_cm * pkg.height_cm / divisor)


def correo_reference_ars(route: GridRoute, pkg: GridPackage) -> float | None:
    """Precio de Correo para el tramo de peso facturable del paquete, o `None` si no hay
    referencia comparable: ruta corta, documento o frágil (el Correo no publica un
    recargo por frágil, así que la banda solo se exige a `standard_package`), o peso
    fuera de los tramos relevados."""
    if route.correo_zone is None or pkg.package_type != PackageType.STANDARD_PACKAGE:
        return None
    weight = billable_weight_kg(pkg)
    brackets = CORREO_HOME_DELIVERY_ARS[route.correo_zone]
    for limit in sorted(brackets):
        if weight <= limit:
            return brackets[limit]
    return None


class GridFuel(FuelPriceProvider):
    async def get_price(self) -> FuelPrice:
        return FuelPrice(ars_per_liter=GRID_FUEL_ARS_PER_L, source="mock")


def grid_request(route: GridRoute, pkg: GridPackage) -> QuoteRequest:
    return QuoteRequest(
        origin_lat=CORDOBA[0],
        origin_lng=CORDOBA[1],
        destination_lat=route.lat,
        destination_lng=route.lng,
        weight_kg=pkg.weight_kg,
        length_cm=pkg.length_cm,
        width_cm=pkg.width_cm,
        height_cm=pkg.height_cm,
        package_type=pkg.package_type,
        include_breakdown=True,
    )


async def quote_cell(route: GridRoute, pkg: GridPackage) -> QuoteResponse:
    return await compute_quote(
        grid_request(route, pkg), fuel_provider=GridFuel(), routes=MockRoutesProvider()
    )


async def quote_grid() -> dict[tuple[str, str], QuoteResponse]:
    return {
        (route.key, pkg.key): await quote_cell(route, pkg) for route in ROUTES for pkg in PACKAGES
    }


def _markdown(grid: dict[tuple[str, str], QuoteResponse]) -> str:
    header = "| Ruta | km | " + " | ".join(p.label for p in PACKAGES) + " |"
    sep = "| --- | ---: | " + " | ".join("---:" for _ in PACKAGES) + " |"
    lines = [header, sep]
    for route in ROUTES:
        first = grid[(route.key, PACKAGES[0].key)]
        km = first.breakdown.distance_km if first.breakdown else 0.0
        cells = []
        for pkg in PACKAGES:
            price = grid[(route.key, pkg.key)].suggested_price_ars
            ref = correo_reference_ars(route, pkg)
            ratio = f" ({price / ref:.2f}x)" if ref else ""
            cells.append(f"{price:,.0f}{ratio}".replace(",", "."))
        lines.append(f"| {route.label} | {km:,.0f} | ".replace(",", ".") + " | ".join(cells) + " |")
    return "\n".join(lines)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    print(_markdown(asyncio.run(quote_grid())))
