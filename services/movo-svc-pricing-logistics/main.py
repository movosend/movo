from fastapi import FastAPI

app = FastAPI(title="movo-svc-pricing-logistics", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Registrar routers acá, ej:
# from app.pricing.routes import router as pricing_router
# app.include_router(pricing_router, prefix="/pricing")
