from enum import Enum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class PackageType(str, Enum):
    LETTER_DOCUMENT = "letter_document"
    STANDARD_PACKAGE = "standard_package"
    FRAGILE_ITEM = "fragile_item"


class PriceCalculationMethod(str, Enum):
    """Debe quedar alineado 1:1 con `PriceCalculationMethod` de
    `shared/movo-shared/src/types/pricing.ts` — el contrato de wire lo comparten
    ambos lados (TS → Python), agregar un valor acá obliga a agregarlo también ahí."""

    EUCLIDEAN_LINEAR_V1 = "euclidean_linear_v1"  # MOVO-82: ya no se emite, persiste en envíos viejos
    DEMAND_FUEL_ROUTES_V1 = "demand_fuel_routes_v1"  # MOVO-138, ADR-025


class CamelModel(BaseModel):
    """Primer contacto de este servicio (Python) con un consumidor TypeScript
    (`movo-svc-shipments/src/adapters/pricing-client.ts`) — el resto del repo Python
    (`movo-svc-pricing-logistics`) no tenía todavía una convención de wire fijada.
    `populate_by_name=True` deja aceptar también snake_case en tests/uso interno."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class DemandContext(CamelModel):
    """Conteos de la zona de retiro (MOVO-138, ADR-025). Los calcula `movo-svc-shipments`,
    dueño de esos datos, así este servicio sigue sin base de datos (ADR-019)."""

    published_shipments: int = Field(ge=0)
    available_carriers: int = Field(ge=0)


class QuoteRequest(CamelModel):
    origin_lat: float = Field(ge=-90, le=90)
    origin_lng: float = Field(ge=-180, le=180)
    destination_lat: float = Field(ge=-90, le=90)
    destination_lng: float = Field(ge=-180, le=180)
    weight_kg: float = Field(gt=0)
    length_cm: float = Field(gt=0)
    width_cm: float = Field(gt=0)
    height_cm: float = Field(gt=0)
    package_type: PackageType
    urgent: bool = False
    # Opcional: sin contexto de demanda no se aplica recargo.
    demand_context: DemandContext | None = None


class QuoteResponse(CamelModel):
    """Sin desglose de la fórmula (MOVO-216/ADR-025): el emisor solo ve el precio final y
    si rige alta demanda. El desglose va al log `pricing_quote_computed`."""

    suggested_price_ars: float
    high_demand: bool
    calculation_method: PriceCalculationMethod
