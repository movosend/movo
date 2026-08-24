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

    EUCLIDEAN_LINEAR_V1 = "euclidean_linear_v1"


class CamelModel(BaseModel):
    """Primer contacto de este servicio (Python) con un consumidor TypeScript
    (`movo-svc-shipments/src/adapters/pricing-client.ts`) — el resto del repo Python
    (`movo-svc-pricing-logistics`) no tenía todavía una convención de wire fijada.
    `populate_by_name=True` deja aceptar también snake_case en tests/uso interno."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


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


class PriceBreakdownItem(CamelModel):
    label: str
    amount_ars: float


class QuoteResponse(CamelModel):
    suggested_price_ars: float
    breakdown: list[PriceBreakdownItem]
    calculation_method: PriceCalculationMethod
