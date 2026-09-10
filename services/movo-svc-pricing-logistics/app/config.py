from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración general de movo-svc-pricing-logistics.

    Incluye los coeficientes de la fórmula provisoria de pricing (MOVO-82)
    y los parámetros de optimización de rutas VRPTW (MOVO-205 / MOVO-217).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Coeficientes de pricing (MOVO-82, calculationMethod euclidean_linear_v1)
    base_fare_ars: float = Field(
        default=1500.0,
        validation_alias=AliasChoices("PRICING_BASE_FARE_ARS", "base_fare_ars"),
    )
    price_per_km_ars: float = Field(
        default=150.0,
        validation_alias=AliasChoices("PRICING_PRICE_PER_KM_ARS", "price_per_km_ars"),
    )
    price_per_kg_ars: float = Field(
        default=300.0,
        validation_alias=AliasChoices("PRICING_PRICE_PER_KG_ARS", "price_per_kg_ars"),
    )
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
    routing_max_corridor_deviation_km: float = Field(
        default=15.0,
        validation_alias=AliasChoices(
            "ROUTING_MAX_CORRIDOR_DEVIATION_KM", "routing_max_corridor_deviation_km"
        ),
    )


settings = Settings()
PricingSettings = Settings  # alias para compatibilidad hacia atrás
