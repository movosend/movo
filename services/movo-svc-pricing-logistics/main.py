from fastapi import FastAPI

from app.routers.quote import router as quote_router

app = FastAPI(title="movo-svc-pricing-logistics", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(quote_router)
