from pydantic_settings import BaseSettings, SettingsConfigDict


class PricingSettings(BaseSettings):
    """Coeficientes de la fórmula provisoria (MOVO-82, calculationMethod
    ``euclidean_linear_v1``), configurables por env var y no hardcodeados —
    el equipo va a querer ajustarlos durante las pruebas sin rebuildear la imagen.
    Los defaults replican la fórmula placeholder que tenía `movo-svc-shipments`
    (MOVO-80) para continuidad de precios, más el factor por `packageType` que ese
    placeholder no tenía (nuevo acá, pedido por AC3).
    """

    model_config = SettingsConfigDict(env_prefix="PRICING_")

    base_fare_ars: float = 1500.0
    price_per_km_ars: float = 150.0
    price_per_kg_ars: float = 300.0

    # Multiplicador sobre el subtotal (base + distancia + peso) según el tipo de
    # paquete. `fragile_item` > 1.0 a propósito: manipulación más cuidadosa por parte
    # del transportista. Valores de equipo, sin estudio de mercado detrás (mismo
    # criterio de placeholder documentado que el resto de esta fórmula).
    factor_letter_document: float = 1.0
    factor_standard_package: float = 1.0
    factor_fragile_item: float = 1.2


settings = PricingSettings()
