from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración general de movo-svc-pricing-logistics.

    Incluye los coeficientes de la fórmula de pricing (MOVO-138)
    y los parámetros de optimización de rutas VRPTW (MOVO-205 / MOVO-217).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Coeficientes de `demand_fuel_routes_v1` (MOVO-138, ADR-025), en LITROS de nafta y no
    # en pesos: la tarifa se indexa sola con el precio del surtidor. Calibrados para que,
    # a 2.222,5 ARS/l, coincidan con la tarifa de euclidean_linear_v1 (1500 base, ~150/km,
    # 300/kg) y el cambio de método no sea un salto de precio (spike §5.2).
    base_fare_l: float = Field(
        default=0.675,
        ge=0,
        validation_alias=AliasChoices("PRICING_BASE_FARE_L", "base_fare_l"),
    )
    # Consumo de un auto mediano (8 l/100 km).
    fuel_l_per_km: float = Field(
        default=0.08,
        ge=0,
        validation_alias=AliasChoices("PRICING_FUEL_L_PER_KM", "fuel_l_per_km"),
    )
    # Parte del combustible que paga el emisor: en P2P el viaje ya ocurría.
    fuel_cost_share: float = Field(
        default=0.6,
        ge=0,
        le=1,
        validation_alias=AliasChoices("PRICING_FUEL_COST_SHARE", "fuel_cost_share"),
    )
    # Desgaste, peajes y tiempo del transportista.
    non_fuel_l_per_km: float = Field(
        default=0.02,
        ge=0,
        validation_alias=AliasChoices("PRICING_NON_FUEL_L_PER_KM", "non_fuel_l_per_km"),
    )
    per_kg_l: float = Field(
        default=0.135,
        ge=0,
        validation_alias=AliasChoices("PRICING_PER_KG_L", "per_kg_l"),
    )

    # Recargo por alta demanda (MOVO-138, ADR-025). Umbral calibrado con Monte Carlo en
    # el spike MOVO-216 (§4.3): recalibrar acá con datos reales, sin tocar código.
    demand_ratio_threshold: float = Field(
        default=3.0,
        gt=0,
        validation_alias=AliasChoices("PRICING_DEMAND_RATIO_THRESHOLD", "demand_ratio_threshold"),
    )
    demand_min_shipments: int = Field(
        default=4,
        ge=1,
        validation_alias=AliasChoices("PRICING_DEMAND_MIN_SHIPMENTS", "demand_min_shipments"),
    )
    demand_base_surcharge: float = Field(
        default=0.1,
        gt=0,
        validation_alias=AliasChoices("PRICING_DEMAND_BASE_SURCHARGE", "demand_base_surcharge"),
    )
    demand_slope: float = Field(
        default=0.05,
        ge=0,
        validation_alias=AliasChoices("PRICING_DEMAND_SLOPE", "demand_slope"),
    )
    demand_max_surcharge: float = Field(
        default=0.3,
        gt=0,
        validation_alias=AliasChoices("PRICING_DEMAND_MAX_SURCHARGE", "demand_max_surcharge"),
    )

    # Multiplicador por `packageType` (MOVO-82), sin cambios en demand_fuel_routes_v1.
    factor_letter_document: float = Field(
        default=1.0,
        validation_alias=AliasChoices("PRICING_FACTOR_LETTER_DOCUMENT", "factor_letter_document"),
    )
    factor_standard_package: float = Field(
        default=1.0,
        validation_alias=AliasChoices("PRICING_FACTOR_STANDARD_PACKAGE", "factor_standard_package"),
    )
    factor_fragile_item: float = Field(
        default=1.2,
        validation_alias=AliasChoices("PRICING_FACTOR_FRAGILE_ITEM", "factor_fragile_item"),
    )

    # Precio de combustible (MOVO-138, ADR-025). `mock` devuelve el fallback fijo sin
    # red ni Redis (default de dev/test/CI); `energia` consulta la API CKAN de la
    # Secretaría de Energía con cache en Redis.
    fuel_price_provider: Literal["mock", "energia"] = Field(
        default="mock",
        validation_alias=AliasChoices("FUEL_PRICE_PROVIDER", "fuel_price_provider"),
    )
    # Mediana nacional de nafta súper relevada el 24/09/2026 (spike MOVO-216). Se usa
    # con el provider `mock`, y con `energia` si no hay Redis ni último valor bueno.
    fuel_price_fallback_ars_per_l: float = Field(
        default=2222.5,
        gt=0,
        validation_alias=AliasChoices(
            "PRICING_FUEL_PRICE_FALLBACK_ARS_PER_L", "fuel_price_fallback_ars_per_l"
        ),
    )
    fuel_cache_ttl_seconds: int = Field(
        default=86400,
        gt=0,
        validation_alias=AliasChoices(
            "PRICING_FUEL_CACHE_TTL_SECONDS", "fuel_cache_ttl_seconds"
        ),
    )

    # Configuración de Routing y VRPTW (MOVO-205 / MOVO-217 / ADR-013 / ADR-015)
    routes_provider: str = Field(
        default="mock",
        validation_alias=AliasChoices("ROUTES_PROVIDER", "routes_provider"),
    )
    google_maps_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GOOGLE_MAPS_API_KEY", "google_maps_api_key"),
    )
    redis_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("REDIS_URL", "redis_url"),
    )

    # Parámetros del Solver OR-Tools
    routing_time_limit_seconds: float = Field(
        default=1.0,
        validation_alias=AliasChoices("ROUTING_TIME_LIMIT_SECONDS", "routing_time_limit_seconds"),
    )
    routing_avg_speed_kmh: float = Field(
        default=40.0,
        validation_alias=AliasChoices("ROUTING_AVG_SPEED_KMH", "routing_avg_speed_kmh"),
    )
    routing_time_slack_minutes: int = Field(
        default=120,
        validation_alias=AliasChoices("ROUTING_TIME_SLACK_MINUTES", "routing_time_slack_minutes"),
    )
    routing_default_service_time_minutes: int = Field(
        default=10,
        validation_alias=AliasChoices(
            "ROUTING_DEFAULT_SERVICE_TIME_MINUTES", "routing_default_service_time_minutes"
        ),
    )
    routing_cache_ttl_seconds: int = Field(
        default=86400,
        validation_alias=AliasChoices(
            "ROUTING_CACHE_TTL_SECONDS", "routing_cache_ttl_seconds"
        ),
    )



settings = Settings()
PricingSettings = Settings  # alias para compatibilidad hacia atrás
