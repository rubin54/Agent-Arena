from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import ModelCatalogEntry
from . import settings_store


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _map_entry(item: dict[str, Any]) -> ModelCatalogEntry:
    model_id = item.get("id", "")
    pricing = item.get("pricing") or {}
    arch = item.get("architecture") or {}
    top = item.get("top_provider") or {}

    return ModelCatalogEntry(
        id=model_id,
        name=item.get("name") or model_id,
        description=item.get("description") or "",
        provider=model_id.split("/")[0] if "/" in model_id else (model_id or "unknown"),
        canonical_slug=item.get("canonical_slug"),
        created_ts=item.get("created"),
        context_length=item.get("context_length") or top.get("context_length"),
        max_completion_tokens=top.get("max_completion_tokens"),
        is_moderated=top.get("is_moderated"),
        price_prompt=_to_float(pricing.get("prompt")),
        price_completion=_to_float(pricing.get("completion")),
        price_request=_to_float(pricing.get("request")),
        price_image=_to_float(pricing.get("image")),
        price_web_search=_to_float(pricing.get("web_search")),
        price_internal_reasoning=_to_float(pricing.get("internal_reasoning")),
        price_cache_read=_to_float(pricing.get("input_cache_read")),
        price_cache_write=_to_float(pricing.get("input_cache_write")),
        modality=arch.get("modality"),
        input_modalities=arch.get("input_modalities") or [],
        output_modalities=arch.get("output_modalities") or [],
        tokenizer=arch.get("tokenizer"),
        instruct_type=arch.get("instruct_type"),
        supported_parameters=item.get("supported_parameters") or [],
        raw=item,
        fetched_at=datetime.now(timezone.utc),
    )


async def refresh_catalog(session: AsyncSession) -> int:
    """Re-fetch the catalog from OpenRouter and replace the local cache."""
    client = await settings_store.build_client(session)
    items = await client.list_models()

    entries = [_map_entry(item) for item in items if item.get("id")]
    # Drop duplicates defensively -- repeated primary keys would break the insert.
    unique: dict[str, ModelCatalogEntry] = {e.id: e for e in entries}

    await session.execute(delete(ModelCatalogEntry))
    session.add_all(list(unique.values()))
    await session.commit()
    return len(unique)


async def get_catalog_meta(session: AsyncSession) -> tuple[int, datetime | None]:
    result = await session.execute(
        select(func.count(ModelCatalogEntry.id), func.max(ModelCatalogEntry.fetched_at))
    )
    count, fetched_at = result.one()
    return count or 0, fetched_at


def is_stale(fetched_at: datetime | None) -> bool:
    if fetched_at is None:
        return True
    ttl = timedelta(minutes=get_settings().catalog_ttl_minutes)
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - fetched_at > ttl


async def list_models(session: AsyncSession) -> list[ModelCatalogEntry]:
    result = await session.execute(select(ModelCatalogEntry).order_by(ModelCatalogEntry.name))
    return list(result.scalars().all())


async def get_model(session: AsyncSession, model_id: str) -> ModelCatalogEntry | None:
    return await session.get(ModelCatalogEntry, model_id)
