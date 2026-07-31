import asyncio
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .routers import agent, models, runs, settings as settings_router, tasks
from .services import sandbox

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")

log = logging.getLogger("arena")

# The agent sandbox shells out to the Docker CLI. Windows' selector loop cannot
# spawn subprocesses, so pin the proactor loop explicitly.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    try:
        await sandbox.cleanup_stale_containers()
    except Exception as exc:  # Docker is not required for one-shot runs
        log.info("Skipped sandbox cleanup: %s", exc)
    yield


app = FastAPI(
    title="Agent Arena API",
    description="Model catalog, task definitions and test runs via OpenRouter.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models.router)
app.include_router(tasks.router)
app.include_router(runs.router)
app.include_router(agent.router)
app.include_router(settings_router.router)


@app.get("/api/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
