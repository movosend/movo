import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers.evaluate import router as evaluate_router
from app.routers.optimize import router as optimize_router
from app.routers.quote import router as quote_router
from app.routers.routes_matrix import router as routes_matrix_router
from app.services.redis_client import close_redis_client, init_redis_client, ping_redis

# Sin esto los `logger.info` de `app.*` no salen a ningún lado (el root queda en WARNING
# sin handler), incluido el log `pricing_quote_computed` que reemplaza al desglose del
# precio (MOVO-138). Las librerías siguen en WARNING.
logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("app").setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_redis_client()
    yield
    await close_redis_client()


app = FastAPI(
    title="movo-svc-pricing-logistics",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    response = {"status": "ok"}
    if settings.redis_url:
        is_redis_alive = await ping_redis()
        response["redis"] = "connected" if is_redis_alive else "disconnected"
    return response


app.include_router(quote_router)
app.include_router(optimize_router)
app.include_router(evaluate_router)
app.include_router(routes_matrix_router)
