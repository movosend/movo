from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración general de movo-svc-pricing-logistics.

    Incluye los coeficientes de la fórmula de pricing (MOVO-138, MOVO-276)
    y los parámetros de optimización de rutas VRPTW (MOVO-205 / MOVO-217).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Coeficientes de `package_tapered_v2` (MOVO-276), en LITROS de nafta y no en pesos: la
    # tarifa se indexa sola con el precio del surtidor (ADR-025). Los de distancia vienen
    # de `demand_fuel_routes_v1`; base y peso se recalibraron contra la grilla de
    # referencia (`docs/pricing/grilla-referencia.md`, banda de 0,6x a 1,0x del Correo).
    # Tarifa base de un paquete (`standard_package`, y `fragile_item` antes del recargo).
    base_fare_l: float = Field(
        default=0.15,
        ge=0,
        validation_alias=AliasChoices("PRICING_BASE_FARE_L", "base_fare_l"),
    )
    # Tarifa base de un documento: menor que la de un paquete (AC3 de MOVO-276).
    base_fare_document_l: float = Field(
        default=0.0,
        ge=0,
        validation_alias=AliasChoices("PRICING_BASE_FARE_DOCUMENT_L", "base_fare_document_l"),
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
    # Por kg de peso FACTURABLE: máx(peso real, L x A x H / divisor), como cotizan Correo,
    # Andreani y OCA. Así un paquete liviano pero grande paga por el espacio que ocupa.
    per_kg_l: float = Field(
        default=0.275,
        ge=0,
        validation_alias=AliasChoices("PRICING_PER_KG_L", "per_kg_l"),
    )
    volumetric_divisor: float = Field(
        default=5000.0,
        gt=0,
        validation_alias=AliasChoices("PRICING_VOLUMETRIC_DIVISOR", "volumetric_divisor"),
    )
    # Tramo decreciente de peso: los primeros `weight_tier_kg` facturables a tarifa llena,
    # el resto al `weight_tier_rate`. Sin esto, el cubo de 1 m³ que admiten los límites
    # (200 kg volumétricos) cotizaba ~135.000 a cualquier destino.
    weight_tier_kg: float = Field(
        default=10.0,
        ge=0,
        validation_alias=AliasChoices("PRICING_WEIGHT_TIER_KG", "weight_tier_kg"),
    )
    weight_tier_rate: float = Field(
        default=0.35,
        ge=0,
        le=1,
        validation_alias=AliasChoices("PRICING_WEIGHT_TIER_RATE", "weight_tier_rate"),
    )
    # MOVO-317 (`package_tapered_v3`): el peso volumétrico cuenta hasta este tope. Sin él, un cubo
    # de 300 cm (5.400 kg volumétricos) cotizaba ~$1.170.000 a 700 km. El peso real no tiene tope.
    volumetric_weight_cap_kg: float = Field(
        default=300.0,
        gt=0,
        validation_alias=AliasChoices("PRICING_VOLUMETRIC_WEIGHT_CAP_KG", "volumetric_weight_cap_kg"),
    )

    # Tramos decrecientes de distancia (hotfix de precios de larga distancia): la tarifa
    # lineal cotizaba ~350k para 2.300 km. En P2P el transportista ya hace el viaje, así
    # que el costo marginal por km cae con la distancia. Km efectivos = primeros
    # `tier1_km` al 100%, hasta `tier2_km` al `tier2_rate`, el resto al `tier3_rate`.
    distance_tier1_km: float = Field(
        default=30.0,
        ge=0,
        validation_alias=AliasChoices("PRICING_DISTANCE_TIER1_KM", "distance_tier1_km"),
    )
    distance_tier2_km: float = Field(
        default=300.0,
        ge=0,
        validation_alias=AliasChoices("PRICING_DISTANCE_TIER2_KM", "distance_tier2_km"),
    )
    distance_tier2_rate: float = Field(
        default=0.2,
        ge=0,
        le=1,
        validation_alias=AliasChoices("PRICING_DISTANCE_TIER2_RATE", "distance_tier2_rate"),
    )
    distance_tier3_rate: float = Field(
        default=0.015,
        ge=0,
        le=1,
        validation_alias=AliasChoices("PRICING_DISTANCE_TIER3_RATE", "distance_tier3_rate"),
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

    # Recargo por manipulación de `fragile_item` sobre el precio del mismo paquete no
    # frágil. Frágil sigue siendo una categoría y no un atributo: el tamaño ya entra por
    # el peso facturable, así que un frasco y un televisor frágiles no cuestan lo mismo.
    fragile_surcharge: float = Field(
        default=0.2,
        ge=0,
        validation_alias=AliasChoices("PRICING_FRAGILE_SURCHARGE", "fragile_surcharge"),
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
