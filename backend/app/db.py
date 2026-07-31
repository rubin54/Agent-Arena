from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request."""
    async with SessionLocal() as session:
        yield session


# create_all only creates missing *tables*, never missing columns. Without a
# migration framework, columns added later need this explicit, idempotent list.
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("tasks", "assertions", "JSONB NOT NULL DEFAULT '[]'::jsonb"),
    ("tasks", "judge_config", "JSONB NOT NULL DEFAULT '{}'::jsonb"),
    ("run_items", "assertion_results", "JSONB NOT NULL DEFAULT '[]'::jsonb"),
    ("run_items", "passed", "BOOLEAN"),
    ("run_items", "rating", "INTEGER"),
    ("run_items", "rating_note", "TEXT"),
    ("run_items", "rated_at", "TIMESTAMPTZ"),
    ("run_items", "judge_score", "DOUBLE PRECISION"),
    ("run_items", "judge_result", "JSONB"),
]


async def init_db() -> None:
    """Create the schema. For a local tool create_all beats a migration framework."""
    from . import models  # noqa: F401  -- register the tables

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table, column, ddl in _ADDED_COLUMNS:
            await conn.execute(
                text(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "{column}" {ddl}')
            )
