from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import AppSetting
from ..openrouter import OpenRouterClient

API_KEY_SETTING = "openrouter_api_key"


async def get_setting(session: AsyncSession, key: str) -> str | None:
    row = await session.get(AppSetting, key)
    return row.value if row else None


async def set_setting(session: AsyncSession, key: str, value: str | None) -> None:
    row = await session.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=value)
        session.add(row)
    else:
        row.value = value
    await session.commit()


async def delete_setting(session: AsyncSession, key: str) -> None:
    row = await session.get(AppSetting, key)
    if row is not None:
        await session.delete(row)
        await session.commit()


async def resolve_api_key(session: AsyncSession) -> tuple[str | None, str]:
    """(key, source) -- a UI override beats the .env."""
    override = await get_setting(session, API_KEY_SETTING)
    if override:
        return override, "override"
    env_key = get_settings().openrouter_api_key
    if env_key:
        return env_key, "env"
    return None, "none"


async def build_client(session: AsyncSession) -> OpenRouterClient:
    settings = get_settings()
    api_key, _ = await resolve_api_key(session)
    return OpenRouterClient(
        api_key=api_key,
        base_url=settings.openrouter_base_url,
        site_url=settings.openrouter_site_url,
        app_name=settings.openrouter_app_name,
        timeout=settings.request_timeout_s,
    )


async def list_override_keys(session: AsyncSession) -> list[str]:
    result = await session.execute(select(AppSetting.key))
    return list(result.scalars().all())


def mask_key(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) <= 10:
        return "*" * len(key)
    return f"{key[:8]}...{key[-4:]}"
